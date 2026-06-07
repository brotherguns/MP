import { before, after } from "@vendetta/patcher";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { findInReactTree } from "@vendetta/utils";
import { FluxDispatcher, React } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { findByProps } from "@vendetta/metro";
import { regexEscaper, isEnabled } from "..";

// All module lookups deferred — avoids null crashes at import time
// when the Metro registry isn't fully populated yet.
let ActionSheet, MessageStore, ChannelStore, ChannelMessages, _ActionSheetRow;

function getModules() {
	ActionSheet     ??= findByProps("openLazy", "hideActionSheet");
	MessageStore    ??= findByProps("getMessage", "getMessages");
	ChannelStore    ??= findByProps("getChannel", "getDMFromUserId");
	ChannelMessages ??= findByProps("_channelMessages");
	// BUG FIX: was `const { ActionSheetRow } = findByProps("ActionSheetRow")`
	// at module scope — crashes if findByProps returns null.
	// Now resolved lazily inside the component render.
	_ActionSheetRow ??= findByProps("ActionSheetRow")?.ActionSheetRow;
}

const isReplyButton = a => a?.props?.label?.toLowerCase?.() === "reply";

const separator = () => new RegExp(regexEscaper("`[ EDITED ]`\n\n"), "gmi");

export default () => {
	getModules();

	if (!ActionSheet) {
		console.warn("[ANTIED Zero] actionsheet: could not find ActionSheet module, patch skipped");
		return () => {};
	}

	return before("openLazy", ActionSheet, ([component, key, actionMessage]) => {
		if (!isEnabled) return;

		try {
			const message = actionMessage?.message;
			if (key !== "MessageLongPressActionSheet" || !message) return;

			component.then(instance => {
				const unpatch = after("default", instance, (_, comp) => {
					try {
						React.useEffect(() => () => unpatch(), []);

						// Re-resolve on each render in case the module loaded late
						getModules();
						const ActionSheetRow = _ActionSheetRow;
						if (!ActionSheetRow) return comp;

						const buttons = findInReactTree(comp, c => c?.find?.(isReplyButton));
						if (!buttons) return comp;

						// Insert our button just after the Reply button (or at end)
						const replyIdx = buttons.findIndex(isReplyButton);
						const insertAt = replyIdx >= 0 ? replyIdx + 1 : buttons.length;

						// Resolve original (unmodified) message content
						let originalMessage =
							MessageStore?.getMessage(message.channel_id, message.id) ||
							ChannelMessages?.get(message.channel_id)?.get(message.id);

						if (!originalMessage) return comp;

						// Only show "Remove Edit History" if buffer is present
						const hasBuffer = separator().test(message.content ?? "");
						if (!hasBuffer) return comp;

						buttons.splice(insertAt, 0, (
							<ActionSheetRow
								label="Remove Edit History"
								subLabel="Added by Antied Zero"
								icon={
									<ActionSheetRow.Icon
										source={getAssetIDByName("ic_edit_24px")}
									/>
								}
								onPress={() => {
									try {
										const parts  = (message?.content ?? "").split(separator());
										// Last segment is the current (most recent) edited content
										const latest = parts[parts.length - 1].trimStart();

										const guildId = ChannelStore
											?.getChannel(originalMessage.channel_id)
											?.guild_id ?? message.guild_id;

										if (!guildId) {
											showToast("[ANTIED Zero] Could not resolve guild_id");
											return;
										}

										FluxDispatcher.dispatch({
											type: "MESSAGE_UPDATE",
											message: {
												...message,
												content:           latest,
												guild_id:          guildId,
												message_reference: message?.message_reference
													|| message?.messageReference
													|| null,
											},
											otherPluginBypass: true,
										});

										ActionSheet.hideActionSheet();
										showToast(
											"Edit history removed",
											getAssetIDByName("ic_edit_24px")
										);
									} catch (e) {
										console.error("[ANTIED Zero] Remove Edit History onPress\n", e);
										showToast("[ANTIED Zero] Failed to remove history");
									}
								}}
							/>
						));

					} catch (e) {
						showToast("[ANTIED Zero] Crash on ActionSheet component, check debug log");
						console.error("[ANTIED Zero] ActionSheet:Component Patch\n", e);
					}
				});
			});

		} catch (e) {
			showToast("[ANTIED Zero] Crash on ActionSheet, check debug log");
			console.error("[ANTIED Zero] ActionSheet Patch\n", e);
		}
	});
};
