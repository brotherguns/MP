import fluxDispatchPatch from "./patches/flux_dispatch";
import selfEditPatch from "./patches/self_edit";
import actionsheet from "./patches/actionsheet";
import SettingPage from "./Settings";

export const regexEscaper = string => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export let isEnabled = false;

const deletedMessageArray = new Map();
let unpatches = [];

// Patch registry: [fn, args]
const patches = [
	[fluxDispatchPatch, [deletedMessageArray]],
	[actionsheet,       []],
	[selfEditPatch,     []],
];

// Inline fetchDB — replaces the broken ~lib/func/bl import
async function fetchDB(url) {
	try {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return await res.json();
	} catch (e) {
		console.error("[ANTIED Zero] fetchDB failed:", e);
		return null;
	}
}

// Inline selfDelete — schedules cleanup of the deletedMessageArray
function selfDelete(datas, delaySecs) {
	if (!datas || !Array.isArray(datas)) return;
	setTimeout(() => {
		deletedMessageArray.clear();
	}, delaySecs * 1000);
}

const database = "https://angelix1.github.io/static_list/antied/list.json";

export default {
	onLoad: async () => {
		// Register all patches inside onLoad so the Metro module registry
		// is fully ready and modules won't resolve to null.
		unpatches = patches.map(([fn, args]) => fn(...args)).filter(Boolean);

		isEnabled = true;

		// Fetch blocklist and schedule periodic map clear
		const datas = await fetchDB(database);
		selfDelete(datas, 15);
	},

	onUnload: () => {
		isEnabled = false;
		unpatches.forEach(u => { try { u?.(); } catch {} });
		unpatches = [];
		deletedMessageArray.clear();
	},

	settings: SettingPage,
};
