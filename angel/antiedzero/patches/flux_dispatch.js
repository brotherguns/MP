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

// Dispatch a fresh event and cancel the original by returning a no-op args array.
// This avoids mutating the live event object in place, which causes Discord's
// JSI bridge (native<->JS serialization layer) to blow up with a
// "Exception in native call from JS" / decodeSerializableValue crash.
function dispatchFresh(event) {
	// Use queueMicrotask so we're fully outside the current dispatch call
	// before firing the new one — prevents re-entrancy issues.
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

			const orig = ChannelMessages?.get(ev.channelId)?.get(ev.id);
			if (!orig?.author?.id || !orig.author.username) return;

			// Drop bot messages and ephemeral messages (flags & 64)
			if (orig.author.bot || (orig.flags & 64)) return;

			// Drop empty messages
			if (!orig.content && !orig.attachments?.length && !orig.embeds?.length) return;

			const entry = deletedMessageArray.get(ev.id);

			// Stage 2 — our ghost MESSAGE_UPDATE already went through, let real delete pass
			if (entry?.stage === 2) {
				if (deletedMessageArray.size >= 100) deletedMessageArray.clear();
				deletedMessageArray.delete(ev.id);
				return; // let Discord remove it normally
			}

			// Stage 1 — this is the real delete arriving after our ghost; let it through
			if (entry?.stage === 1) {
				entry.stage = 2;
				return;
			}

			// Stage 0 — intercept: cancel original delete, fire a ghost MESSAGE_UPDATE instead
			const channelId = orig.channel_id || ev.channelId;
			const guildId   = ChannelStore?.getChannel(channelId)?.guild_id;

			deletedMessageArray.set(ev.id, { stage: 1 });

			// FIX: dispatch a completely fresh object instead of mutating ev in place.
			// Mutating ev while Discord's bridge is mid-serialization = native crash.
			dispatchFresh({
				type:                "MESSAGE_UPDATE",
				channelId,
				optimistic:          false,
				sendMessageOptions:  {},
				isPushNotification:  false,
				message: {
					...orig,
					content:           orig.content,
					channel_id:        channelId,
					guild_id:          guildId,
					message_reference: orig?.message_reference || orig?.messageReference || null,
					flags:             64,
				},
			});

			// Cancel the original MESSAGE_DELETE by zeroing args[0]
			// so Flux sees a no-op event type it doesn't handle.
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

			const orig =
				MessageStore?.getMessage(chId, id) ||
				ChannelMessages?.get(chId)?.get(id);

			if (!orig?.author?.id || !orig.author.username) return;
			if (!orig.content && !orig.attachments?.length && !orig.embeds?.length) return;

			// No actual content change — nothing to annotate
			if (!msg.content || msg.content === orig.content) return;

			const prefix = "`[ EDITED ]`\n\n";

			// FIX: dispatch a fresh event rather than mutating ev.message in place
			dispatchFresh({
				...ev,
				message: {
					...msg,
					content:           `${orig.content} ${prefix}${msg.content}`,
					guild_id:          ChannelStore?.getChannel(chId)?.guild_id ?? msg.guild_id,
					edited_timestamp:  "invalid_timestamp",
					message_reference: msg?.message_reference || orig?.messageReference || null,
				},
			});

			// Cancel the original so we don't get a double render
			args[0] = { type: "__ANTIED_CANCELLED__" };
		}

	} catch (e) {
		showToast("[ANTIED Zero] FluxDispatcher crash – check logs");
		console.error("[ANTIED Zero] Flux patch\n", e);
	}
});
