import { before } from "@vendetta/patcher";
import { findByProps } from "@vendetta/metro";
import { showToast } from "@vendetta/ui/toasts";
import { FluxDispatcher } from "@vendetta/metro/common";

import { isEnabled } from "..";

let ChannelStore, ChannelMessages, MessageStore;
function getModules() {
	ChannelStore    ??= findByProps("getChannel", "getDMFromUserId");
	ChannelMessages ??= findByProps("_channelMessages");
	MessageStore    ??= findByProps("getMessage", "getMessages");
}

// _channelMessages is a plain object: { [channelId]: ChannelMessages }
// ChannelMessages._map is a plain object: { [messageId]: message }
// ChannelMessages._array is the array of message objects
// DO NOT call .get() on either — they are not Maps.
function getMessage(channelId, messageId) {
	// MessageStore.getMessage is the safest path
	const fromStore = MessageStore?.getMessage?.(channelId, messageId);
	if (fromStore) return fromStore;

	// Fallback: dig into _channelMessages._map directly
	const chan = ChannelMessages?._channelMessages?.[channelId];
	return chan?._map?.[messageId] ?? null;
}

function dispatchFresh(event) {
	queueMicrotask(() => {
		FluxDispatcher.dispatch({ ...event, otherPluginBypass: true });
	});
}

export default deletedMessageArray => before("dispatch", FluxDispatcher, args => {
	if (!isEnabled) return;

	try {
		const ev = args[0];
		if (!ev?.type) return;

		getModules();

		/* =============================================================
			MESSAGE_DELETE — ghost the message instead of removing it
		===============================================================*/
		if (ev.type === "MESSAGE_DELETE") {
			if (ev.otherPluginBypass) return;

			const channelId = ev.channelId;
			const messageId = ev.id;

			const orig = getMessage(channelId, messageId);
			if (!orig?.author?.id || !orig.author.username) return;

			// Drop bots and ephemeral messages
			if (orig.author.bot || (orig.flags & 64)) return;

			// Drop empty messages
			if (!orig.content && !orig.attachments?.length && !orig.embeds?.length) return;

			const entry = deletedMessageArray.get(messageId);

			// Stage 2 — ghost already shown, let real delete through
			if (entry?.stage === 2) {
				if (deletedMessageArray.size >= 100) deletedMessageArray.clear();
				deletedMessageArray.delete(messageId);
				return;
			}

			// Stage 1 — real delete arriving after our ghost dispatch
			if (entry?.stage === 1) {
				entry.stage = 2;
				return;
			}

			// Stage 0 — first delete: cancel it, fire a ghost MESSAGE_UPDATE
			const guildId = ChannelStore?.getChannel?.(channelId)?.guild_id;

			deletedMessageArray.set(messageId, { stage: 1 });

			dispatchFresh({
				type:               "MESSAGE_UPDATE",
				channelId,
				optimistic:         false,
				sendMessageOptions: {},
				isPushNotification: false,
				message: {
					...orig,
					content:           orig.content,
					channel_id:        channelId,
					guild_id:          guildId,
					message_reference: orig.message_reference || orig.messageReference || null,
					flags:             64,
				},
			});

			// Cancel original delete
			args[0] = { type: "__ANTIED_CANCELLED__" };
			return;
		}

		/* =============================================================
			MESSAGE_UPDATE — prepend original content before edited content
		===============================================================*/
		if (ev.type === "MESSAGE_UPDATE") {
			if (ev.otherPluginBypass) return;

			const msg = ev.message;
			if (!msg || msg.author?.bot) return;

			const chId = msg.channel_id || ev.channelId;
			const id   = msg.id || ev.id;

			const orig = getMessage(chId, id);
			if (!orig?.author?.id || !orig.author.username) return;
			if (!orig.content && !orig.attachments?.length && !orig.embeds?.length) return;

			// No actual content change
			if (!msg.content || msg.content === orig.content) return;

			// Already has our marker — don't double-annotate
			if (orig.content?.includes("`[ EDITED ]`")) return;

			dispatchFresh({
				...ev,
				message: {
					...msg,
					content:           `${orig.content} \`[ EDITED ]\`\n\n${msg.content}`,
					guild_id:          ChannelStore?.getChannel?.(chId)?.guild_id ?? msg.guild_id,
					edited_timestamp:  "invalid_timestamp",
					message_reference: msg.message_reference || orig.messageReference || null,
				},
			});

			args[0] = { type: "__ANTIED_CANCELLED__" };
		}

	} catch (e) {
		showToast("[ANTIED Zero] FluxDispatcher crash – check logs");
		console.error("[ANTIED Zero] Flux patch\n", e);
	}
});
