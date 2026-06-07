import { before } from "@vendetta/patcher";
import { findByProps } from "@vendetta/metro";
import { regexEscaper, isEnabled } from "..";

// Deferred so the module registry is ready when this is first called,
// not at import time (which happens before onLoad).
let Message;
function getModule() {
	Message ??= findByProps("sendMessage", "startEditMessage");
}

export default () => {
	getModule();

	if (!Message) {
		console.warn("[ANTIED Zero] self_edit: could not find Message module, patch skipped");
		return () => {};
	}

	return before("startEditMessage", Message, args => {
		if (!isEnabled) return;

		// args: [channelId, messageId, content]
		const msg = args[2];
		if (typeof msg !== "string") return;

		const separator = new RegExp(regexEscaper("`[ EDITED ]`\n\n"), "gmi");
		const parts = msg.split(separator);

		// Keep only the last (most recent) content after all EDITED markers
		args[2] = parts[parts.length - 1].trimStart();
	});
};
