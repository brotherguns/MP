(function(exports,patcher,metro,toasts,common,assets,utils,storage,plugin,components){'use strict';let ChannelStore$1, ChannelMessages$1, MessageStore$1;
function getModules$1() {
  ChannelStore$1 ?? (ChannelStore$1 = metro.findByProps("getChannel", "getDMFromUserId"));
  ChannelMessages$1 ?? (ChannelMessages$1 = metro.findByProps("_channelMessages"));
  MessageStore$1 ?? (MessageStore$1 = metro.findByProps("getMessage", "getMessages"));
}
function dispatchFresh(event) {
  queueMicrotask(function() {
    common.FluxDispatcher.dispatch({
      ...event,
      otherPluginBypass: true
    });
  });
}
function fluxDispatchPatch(deletedMessageArray) {
  return patcher.before("dispatch", common.FluxDispatcher, function(args) {
    if (!exports.isEnabled)
      return;
    try {
      const ev = args[0];
      if (!ev?.type)
        return;
      getModules$1();
      if (ev.type === "MESSAGE_DELETE") {
        if (ev.otherPluginBypass)
          return;
        const orig = ChannelMessages$1?.get(ev.channelId)?.get(ev.id);
        if (!orig?.author?.id || !orig.author.username)
          return;
        if (orig.author.bot || orig.flags & 64)
          return;
        if (!orig.content && !orig.attachments?.length && !orig.embeds?.length)
          return;
        const entry = deletedMessageArray.get(ev.id);
        if (entry?.stage === 2) {
          if (deletedMessageArray.size >= 100)
            deletedMessageArray.clear();
          deletedMessageArray.delete(ev.id);
          return;
        }
        if (entry?.stage === 1) {
          entry.stage = 2;
          return;
        }
        const channelId = orig.channel_id || ev.channelId;
        const guildId = ChannelStore$1?.getChannel(channelId)?.guild_id;
        deletedMessageArray.set(ev.id, {
          stage: 1
        });
        dispatchFresh({
          type: "MESSAGE_UPDATE",
          channelId,
          optimistic: false,
          sendMessageOptions: {},
          isPushNotification: false,
          message: {
            ...orig,
            content: orig.content,
            channel_id: channelId,
            guild_id: guildId,
            message_reference: orig?.message_reference || orig?.messageReference || null,
            flags: 64
          }
        });
        args[0] = {
          type: "__ANTIED_CANCELLED__"
        };
        return;
      }
      if (ev.type === "MESSAGE_UPDATE") {
        if (ev.otherPluginBypass)
          return;
        const msg = ev.message;
        if (!msg || msg.author?.bot)
          return;
        const chId = msg.channel_id || ev.channelId;
        const id = msg.id || ev.id;
        const orig = MessageStore$1?.getMessage(chId, id) || ChannelMessages$1?.get(chId)?.get(id);
        if (!orig?.author?.id || !orig.author.username)
          return;
        if (!orig.content && !orig.attachments?.length && !orig.embeds?.length)
          return;
        if (!msg.content || msg.content === orig.content)
          return;
        const prefix = "`[ EDITED ]`\n\n";
        dispatchFresh({
          ...ev,
          message: {
            ...msg,
            content: `${orig.content} ${prefix}${msg.content}`,
            guild_id: ChannelStore$1?.getChannel(chId)?.guild_id ?? msg.guild_id,
            edited_timestamp: "invalid_timestamp",
            message_reference: msg?.message_reference || orig?.messageReference || null
          }
        });
        args[0] = {
          type: "__ANTIED_CANCELLED__"
        };
      }
    } catch (e) {
      toasts.showToast("[ANTIED Zero] FluxDispatcher crash \u2013 check logs");
      console.error("[ANTIED Zero] Flux patch\n", e);
    }
  });
}let Message;
function getModule() {
  Message ?? (Message = metro.findByProps("sendMessage", "startEditMessage"));
}
function selfEditPatch() {
  getModule();
  if (!Message) {
    console.warn("[ANTIED Zero] self_edit: could not find Message module, patch skipped");
    return function() {
    };
  }
  return patcher.before("startEditMessage", Message, function(args) {
    if (!exports.isEnabled)
      return;
    const msg = args[2];
    if (typeof msg !== "string")
      return;
    const separator = new RegExp(regexEscaper("`[ EDITED ]`\n\n"), "gmi");
    const parts = msg.split(separator);
    args[2] = parts[parts.length - 1].trimStart();
  });
}let ActionSheet, MessageStore, ChannelStore, ChannelMessages, _ActionSheetRow;
function getModules() {
  ActionSheet ?? (ActionSheet = metro.findByProps("openLazy", "hideActionSheet"));
  MessageStore ?? (MessageStore = metro.findByProps("getMessage", "getMessages"));
  ChannelStore ?? (ChannelStore = metro.findByProps("getChannel", "getDMFromUserId"));
  ChannelMessages ?? (ChannelMessages = metro.findByProps("_channelMessages"));
  _ActionSheetRow ?? (_ActionSheetRow = metro.findByProps("ActionSheetRow")?.ActionSheetRow);
}
const isReplyButton = function(a) {
  return a?.props?.label?.toLowerCase?.() === "reply";
};
const separator = function() {
  return new RegExp(regexEscaper("`[ EDITED ]`\n\n"), "gmi");
};
function actionsheet() {
  getModules();
  if (!ActionSheet) {
    console.warn("[ANTIED Zero] actionsheet: could not find ActionSheet module, patch skipped");
    return function() {
    };
  }
  return patcher.before("openLazy", ActionSheet, function([component, key, actionMessage]) {
    if (!exports.isEnabled)
      return;
    try {
      const message = actionMessage?.message;
      if (key !== "MessageLongPressActionSheet" || !message)
        return;
      component.then(function(instance) {
        const unpatch = patcher.after("default", instance, function(_, comp) {
          try {
            common.React.useEffect(function() {
              return function() {
                return unpatch();
              };
            }, []);
            getModules();
            const ActionSheetRow = _ActionSheetRow;
            if (!ActionSheetRow)
              return comp;
            const buttons = utils.findInReactTree(comp, function(c) {
              return c?.find?.(isReplyButton);
            });
            if (!buttons)
              return comp;
            const replyIdx = buttons.findIndex(isReplyButton);
            const insertAt = replyIdx >= 0 ? replyIdx + 1 : buttons.length;
            let originalMessage = MessageStore?.getMessage(message.channel_id, message.id) || ChannelMessages?.get(message.channel_id)?.get(message.id);
            if (!originalMessage)
              return comp;
            const hasBuffer = separator().test(message.content ?? "");
            if (!hasBuffer)
              return comp;
            buttons.splice(insertAt, 0, /* @__PURE__ */ common.React.createElement(ActionSheetRow, {
              label: "Remove Edit History",
              subLabel: "Added by Antied Zero",
              icon: /* @__PURE__ */ common.React.createElement(ActionSheetRow.Icon, {
                source: assets.getAssetIDByName("ic_edit_24px")
              }),
              onPress: function() {
                try {
                  const parts = (message?.content ?? "").split(separator());
                  const latest = parts[parts.length - 1].trimStart();
                  const guildId = ChannelStore?.getChannel(originalMessage.channel_id)?.guild_id ?? message.guild_id;
                  if (!guildId) {
                    toasts.showToast("[ANTIED Zero] Could not resolve guild_id");
                    return;
                  }
                  common.FluxDispatcher.dispatch({
                    type: "MESSAGE_UPDATE",
                    message: {
                      ...message,
                      content: latest,
                      guild_id: guildId,
                      message_reference: message?.message_reference || message?.messageReference || null
                    },
                    otherPluginBypass: true
                  });
                  ActionSheet.hideActionSheet();
                  toasts.showToast("Edit history removed", assets.getAssetIDByName("ic_edit_24px"));
                } catch (e) {
                  console.error("[ANTIED Zero] Remove Edit History onPress\n", e);
                  toasts.showToast("[ANTIED Zero] Failed to remove history");
                }
              }
            }));
          } catch (e) {
            toasts.showToast("[ANTIED Zero] Crash on ActionSheet component, check debug log");
            console.error("[ANTIED Zero] ActionSheet:Component Patch\n", e);
          }
        });
      });
    } catch (e) {
      toasts.showToast("[ANTIED Zero] Crash on ActionSheet, check debug log");
      console.error("[ANTIED Zero] ActionSheet Patch\n", e);
    }
  });
}const UserStore = metro.findByStoreName("UserStore");
const { ScrollView, View, Image } = components.General;
const { FormArrow, FormRow: FormRow$1, FormSection, FormDivider } = components.Forms;
const devs = [
  {
    name: "Angel",
    role: "Author & Maintainer",
    uuid: "692632336961110087"
  }
];
const qa = [
  {
    name: "Moodle",
    role: "Quality Assurance",
    uuid: "807170846497570848"
  },
  {
    name: "Rairof",
    role: "Quality Assurance",
    uuid: "923212189123346483"
  },
  {
    name: "Catinette",
    role: "Quality Assurance",
    uuid: "1302022854740807730"
  },
  {
    name: "Win8.1VMUser",
    role: "Quality Assurance",
    uuid: "793935599702507542"
  }
];
const links = [
  {
    label: "Source Code",
    url: "https://github.com/angelix1/MP"
  },
  {
    label: "Tip via PayPal",
    url: "https://paypal.me/alixymizuki"
  },
  {
    label: "Buy me a Ko-fi",
    url: "https://ko-fi.com/angel_wolf"
  }
];
function CreditsPage() {
  storage.useProxy(plugin.storage);
  const open = function(uri) {
    return common.url.openURL(uri).catch(function() {
    });
  };
  const getUser = function(id) {
    return UserStore?.getUser(id) || Object.values(UserStore?.getUsers()).find(function(u) {
      return u.id === id;
    }) || null;
  };
  const getUserPng = function(id) {
    const u = getUser(id);
    return u?.getAvatarURL?.()?.replace("webp", "png") || null;
  };
  const box = function(u) {
    return /* @__PURE__ */ common.React.createElement(Image, {
      source: {
        uri: u
      },
      style: {
        width: 40,
        height: 40,
        borderRadius: 20
      }
    });
  };
  return /* @__PURE__ */ common.React.createElement(common.React.Fragment, null, /* @__PURE__ */ common.React.createElement(ScrollView, null, /* @__PURE__ */ common.React.createElement(FormSection, {
    title: "Developers"
  }, devs.map(function(p, i) {
    const avatarUri = getUserPng(p?.uuid);
    return /* @__PURE__ */ common.React.createElement(FormRow$1, {
      key: i,
      label: p.name,
      subLabel: p.role,
      leading: avatarUri ? box(avatarUri) : null
    });
  })), /* @__PURE__ */ common.React.createElement(FormSection, {
    title: "Testers"
  }, qa.map(function(p, i) {
    const avatarUri = getUserPng(p?.uuid);
    return /* @__PURE__ */ common.React.createElement(FormRow$1, {
      key: i,
      label: p.name,
      subLabel: p.role,
      leading: avatarUri ? box(avatarUri) : null
    });
  })), /* @__PURE__ */ common.React.createElement(FormDivider, null), /* @__PURE__ */ common.React.createElement(FormSection, {
    title: "Support & Source"
  }, /* @__PURE__ */ common.React.createElement(View, {
    style: {
      margin: 50
    }
  }, links.map(function(l, i) {
    let finalIcon = l.icon ? l.icon?.startsWith("https") ? /* @__PURE__ */ common.React.createElement(Image, {
      source: {
        uri: l.icon
      },
      style: {
        width: 120,
        height: 40
      }
    }) : /* @__PURE__ */ common.React.createElement(FormRow$1.Icon, {
      source: assets.getAssetIDByName(l.icon)
    }) : null;
    return /* @__PURE__ */ common.React.createElement(FormRow$1, {
      key: i,
      label: l.label,
      leading: finalIcon,
      trailing: /* @__PURE__ */ common.React.createElement(FormArrow, null),
      onPress: function() {
        return open(l.url);
      }
    });
  }))), /* @__PURE__ */ common.React.createElement(FormDivider, null), /* @__PURE__ */ common.React.createElement(View, {
    style: {
      height: 40
    }
  })));
}const { FormRow } = components.Forms;
function SettingPage() {
  storage.useProxy(plugin.storage);
  const navigation = common.NavigationNative.useNavigation();
  const openCreditPage = function() {
    navigation.push("VendettaCustomPage", {
      title: `Credits & Support`,
      render: function() {
        return common.React.createElement(CreditsPage);
      }
    });
  };
  return /* @__PURE__ */ common.React.createElement(common.React.Fragment, null, /* @__PURE__ */ common.React.createElement(FormRow, {
    label: "CREDITS",
    subLabel: "See the people behind the plugin and ways to support its development.",
    onPress: openCreditPage,
    trailing: /* @__PURE__ */ common.React.createElement(FormRow.Icon, {
      source: assets.getAssetIDByName("ic_arrow_right")
    })
  }));
}const regexEscaper = function(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};
exports.isEnabled = false;
const deletedMessageArray = /* @__PURE__ */ new Map();
let unpatches = [];
const patches = [
  [
    fluxDispatchPatch,
    [
      deletedMessageArray
    ]
  ],
  [
    actionsheet,
    []
  ],
  [
    selfEditPatch,
    []
  ]
];
async function fetchDB(url) {
  try {
    const res = await fetch(url);
    if (!res.ok)
      throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error("[ANTIED Zero] fetchDB failed:", e);
    return null;
  }
}
function selfDelete(datas, delaySecs) {
  if (!datas || !Array.isArray(datas))
    return;
  setTimeout(function() {
    deletedMessageArray.clear();
  }, delaySecs * 1e3);
}
const database = "https://angelix1.github.io/static_list/antied/list.json";
var index = {
  onLoad: async function() {
    unpatches = patches.map(function([fn, args]) {
      return fn(...args);
    }).filter(Boolean);
    exports.isEnabled = true;
    const datas = await fetchDB(database);
    selfDelete(datas, 15);
  },
  onUnload: function() {
    exports.isEnabled = false;
    unpatches.forEach(function(u) {
      try {
        u?.();
      } catch {
      }
    });
    unpatches = [];
    deletedMessageArray.clear();
  },
  settings: SettingPage
};exports.default=index;exports.regexEscaper=regexEscaper;Object.defineProperty(exports,'__esModule',{value:true});return exports;})({},vendetta.patcher,vendetta.metro,vendetta.ui.toasts,vendetta.metro.common,vendetta.ui.assets,vendetta.utils,vendetta.storage,vendetta.plugin,vendetta.ui.components);