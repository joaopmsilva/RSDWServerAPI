#include "chat.h"
#include "bans.h"
#include "dom_engine.h"
#include "items.h"
#include "native_call.h"
#include "process_event.h"
#include "../events/event_log.h"
#include "../utils/logger.h"
#include "../utils/memory.h"

#include <algorithm>
#include <chrono>
#include <cstring>
#include <map>
#include <mutex>
#include <sstream>
#include <vector>

namespace DomChat {

namespace {

using namespace DomEngine;

// FChatMessageData - Source: RSDWSDK/CppSDK/Assertions.inl
constexpr uintptr_t kSenderId      = 0x00;
constexpr uintptr_t kSecondaryId   = 0x30;
constexpr uintptr_t kCharacterGuid = 0x60;
constexpr uintptr_t kPlayerId      = 0x70;
constexpr uintptr_t kColor         = 0x74;
constexpr uintptr_t kMessageBody   = 0x78;
constexpr size_t    kMessageSize   = 0x88;

// FChatPlayerEventData - Source: RSDWSDK/CppSDK/SDK/JagexChatBackend_structs.hpp
constexpr uintptr_t kEventTag  = 0x78;
constexpr size_t    kEventSize = 0x80;

// ADominionPlayerController::PlayerChatComponent - Source: Assertions.inl. Only a
// first guess: game patches move it, so ChatComponentOf() checks the class and
// searches the controller when it's wrong.
constexpr uintptr_t kControllerChatComponent = 0x1288;
constexpr uintptr_t kControllerScanEnd = 0x2000;
uintptr_t g_ChatComponentOffset = kControllerChatComponent;
bool g_ChatComponentMissingLogged = false;
bool g_ChatComponentVerified = false;

typedef void (*ExecThunk)(void* context, void* frame, void* result);

constexpr uintptr_t kExecFunction = 0xD8;

ExecThunk g_OriginalSend = nullptr;
uintptr_t g_SendFunction = 0;
uintptr_t g_ReceiveFunction = 0;
uintptr_t g_AdminFunction = 0;
uintptr_t g_AdminLibrary = 0;
uintptr_t g_ClientEventFunction = 0;
uintptr_t g_ServerEventFunction = 0;
uintptr_t g_SystemMessageFunction = 0;
bool g_Hooked = false;
std::string g_Status = "not initialised";

// The chat and privilege classes live in plugins the game can load after the
// engine is up, so whatever isn't found at start is looked for again.
using Clock = std::chrono::steady_clock;
bool g_LookupDone = false;
int g_Lookups = 0;
Clock::time_point g_FirstLookup;
Clock::time_point g_NextLookup;
bool g_CandidatesLogged = false;

std::mutex g_ListenerMutex;
std::vector<Listener> g_Listeners;
std::vector<EventListener> g_EventListeners;

std::mutex g_VTableMutex;
std::map<uintptr_t, GameThread::ProcessEventFn> g_HookedVTables;
std::map<std::string, std::chrono::steady_clock::time_point> g_RecentEvents;

void WriteFString(uintptr_t dest, const std::string& value) {
    int32_t count = (int32_t)value.size() + 1;
    char16_t* buffer = new char16_t[(size_t)count];
    for (size_t i = 0; i < value.size(); i++) buffer[i] = (char16_t)(unsigned char)value[i];
    buffer[value.size()] = 0;

    *(char16_t**)(dest) = buffer;
    *(int32_t*)(dest + 8) = count;
    *(int32_t*)(dest + 12) = count;
}

void Deliver(const Message& message) {
    std::vector<Listener> listeners;
    {
        std::lock_guard<std::mutex> lock(g_ListenerMutex);
        listeners = g_Listeners;
    }
    for (const Listener& listener : listeners) {
        try {
            listener(message);
        } catch (...) {
        }
    }
}

void DeliverEvent(const PlayerEvent& event) {
    std::vector<EventListener> listeners;
    {
        std::lock_guard<std::mutex> lock(g_ListenerMutex);
        listeners = g_EventListeners;
    }
    for (const EventListener& listener : listeners) {
        try {
            listener(event);
        } catch (...) {
        }
    }
}

void HandlePlayerEvent(uintptr_t params) {
    Engine* engine = g_Engine;
    if (!engine || !Mem::Readable((void*)params, kEventSize)) return;

    PlayerEvent event;
    uint32_t tagIndex = (uint32_t)Mem::ReadI32(params + kEventTag);
    uint32_t tagNumber = (uint32_t)Mem::ReadI32(params + kEventTag + 4);
    event.tag = engine->NameToString(tagIndex, tagNumber);
    if (event.tag.empty() || event.tag == "None") return;

    event.characterGuid = engine->ReadGuid(params + kCharacterGuid);
    event.playerId = Mem::ReadI32(params + kPlayerId);
    std::string source;
    event.senderNetId = engine->ReadUniqueNetId(params + kSenderId, source);

    std::string key = std::to_string(event.playerId) + "|" + event.characterGuid + "|" + event.tag;
    auto now = std::chrono::steady_clock::now();
    {
        std::lock_guard<std::mutex> lock(g_VTableMutex);
        auto it = g_RecentEvents.find(key);
        if (it != g_RecentEvents.end() && now - it->second < std::chrono::seconds(3)) return;
        g_RecentEvents[key] = now;
        for (auto entry = g_RecentEvents.begin(); entry != g_RecentEvents.end();) {
            if (now - entry->second > std::chrono::seconds(30)) entry = g_RecentEvents.erase(entry);
            else ++entry;
        }
    }

    for (const PlayerInfo& player : engine->GetAllPlayers()) {
        if (player.playerId != event.playerId &&
            (event.characterGuid.empty() || player.characterGuid != event.characterGuid)) continue;
        event.senderName = player.characterName.empty() ? player.name : player.characterName;
        if (event.senderNetId.empty()) event.senderNetId = player.uniqueNetId;
        break;
    }

    LogMessage("Chat: player event '" + event.tag + "' from " +
               (event.senderName.empty() ? "playerId " + std::to_string(event.playerId) : event.senderName));
    DeliverEvent(event);
}

void HookedChatProcessEvent(void* self, void* function, void* params) {
    GameThread::ProcessEventFn previous = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_VTableMutex);
        uintptr_t vtable = Mem::ReadPtr((uintptr_t)self);
        auto it = g_HookedVTables.find(vtable);
        if (it != g_HookedVTables.end()) previous = it->second;
    }

    uintptr_t fn = (uintptr_t)function;
    if (fn && (fn == g_ClientEventFunction || fn == g_ServerEventFunction)) {
        HandlePlayerEvent((uintptr_t)params);
    } else if (fn && fn == g_SystemMessageFunction && g_Engine && Mem::Readable(params, 8)) {
        uint32_t tagIndex = (uint32_t)Mem::ReadI32((uintptr_t)params);
        uint32_t tagNumber = (uint32_t)Mem::ReadI32((uintptr_t)params + 4);
        LogMessage("Chat: system message '" + g_Engine->NameToString(tagIndex, tagNumber) + "'");
    }

    if (previous) previous(self, function, params);
}

bool IsChatComponent(uintptr_t object) {
    return object && Mem::Readable((void*)object, 0x30) && g_Engine->IsA(object, "PlayerChatComponent");
}

// The controller's PlayerChatComponent, or 0. The offset found is kept for
// every later call.
uintptr_t ChatComponentOf(uintptr_t controller) {
    if (!controller || !g_Engine) return 0;

    uintptr_t component = Mem::ReadPtr(controller + g_ChatComponentOffset);
    if (IsChatComponent(component)) {
        g_ChatComponentVerified = true;
        return component;
    }

    for (uintptr_t offset = 0x28; offset < kControllerScanEnd; offset += sizeof(uintptr_t)) {
        component = Mem::ReadPtr(controller + offset);
        if (!IsChatComponent(component)) continue;

        LogMessage("Chat: PlayerChatComponent found at controller +" + HexString(offset) +
                   " (the SDK said +" + HexString(kControllerChatComponent) + ")");
        g_ChatComponentOffset = offset;
        g_ChatComponentVerified = true;
        return component;
    }

    if (!g_ChatComponentMissingLogged) {
        g_ChatComponentMissingLogged = true;
        LogMessage("Chat: no PlayerChatComponent on the player controller; broadcast and chat "
                   "command replies are unavailable");
    }
    return 0;
}

bool SendToPlayer(const PlayerInfo& player, const std::string& body) {
    if (!g_ReceiveFunction || !GameThread::HasProcessEvent()) return false;
    if (!player.controllerPtr || !player.playerStatePtr) return false;

    uintptr_t component = ChatComponentOf(player.controllerPtr);
    if (!component || !Mem::Readable((void*)component, 0x150)) return false;

    uint8_t params[kMessageSize + 16];
    memset(params, 0, sizeof(params));

    uintptr_t netId = player.playerStatePtr + Offsets::PlayerState_UniqueID;
    if (Mem::Readable((void*)netId, Offsets::NetIdRepl_Size)) {
        memcpy(params + kSenderId, (void*)netId, Offsets::NetIdRepl_Size);
    }
    uintptr_t secondary = player.playerStatePtr + Offsets::DomPlayerState_NetIdSecondary;
    if (Mem::Readable((void*)secondary, Offsets::NetIdRepl_Size)) {
        memcpy(params + kSecondaryId, (void*)secondary, Offsets::NetIdRepl_Size);
    }
    uintptr_t guid = player.playerStatePtr + Offsets::DomPlayerState_CharacterGuid;
    if (Mem::Readable((void*)guid, 16)) {
        memcpy(params + kCharacterGuid, (void*)guid, 16);
    }
    *(int32_t*)(params + kPlayerId) = player.playerId;
    *(uint32_t*)(params + kColor) = 0xFFFFFFFF;
    WriteFString((uintptr_t)params + kMessageBody, body);

    GameThread::CallFunction(component, g_ReceiveFunction, params);
    return true;
}

bool IsAdmin(uintptr_t controller) {
    if (!controller || !g_AdminFunction || !g_AdminLibrary) return false;
    if (!NativeCall::IsNative(g_AdminFunction)) return false;

    struct Params {
        uintptr_t Controller;
        bool ReturnValue;
        uint8_t Pad[7];
    } params = {};
    params.Controller = controller;

    if (!NativeCall::Invoke(g_AdminLibrary, g_AdminFunction, &params, 0x08)) return false;
    return params.ReturnValue;
}

std::vector<std::string> Split(const std::string& line) {
    std::istringstream stream(line);
    std::vector<std::string> parts;
    std::string part;
    while (stream >> part) parts.push_back(part);
    return parts;
}

std::string Join(const std::vector<std::string>& parts, size_t from) {
    std::string out;
    for (size_t i = from; i < parts.size(); i++) {
        if (!out.empty()) out += " ";
        out += parts[i];
    }
    return out;
}

std::string Lower(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(),
                   [](unsigned char c) { return (char)tolower(c); });
    return value;
}

bool HandleCommand(const PlayerInfo& sender, const std::string& body) {
    std::vector<std::string> parts = Split(body);
    if (parts.empty()) return false;

    std::string command = Lower(parts[0]);

    // Anyone: /link <code> from the Discord bot's /link. Kept out of chat so the
    // code isn't seen; the bot reads it from the event feed and answers.
    if (command == "/link") {
        if (parts.size() < 2) {
            SendToPlayer(sender, "[Server] Use /link in Discord to get a code, then type /link <code> here.");
            return true;
        }
        EventLog::Event event;
        event.type = "link";
        event.name = sender.characterName.empty() ? sender.name : sender.characterName;
        event.netId = sender.uniqueNetId;
        event.characterGuid = sender.characterGuid;
        event.playerId = sender.playerId;
        event.message = parts[1];
        EventLog::Push(std::move(event));
        SendToPlayer(sender, "[Server] Code received - checking it with Discord...");
        LogMessage("Chat: '" + sender.name + "' sent a link code");
        return true;
    }

    if (command != "/kick" && command != "/ban" && command != "/unban" &&
        command != "/give" && command != "/help") {
        return false;
    }

    if (!IsAdmin(sender.controllerPtr)) {
        SendToPlayer(sender, "[Server] You are not an admin.");
        LogMessage("Chat: '" + sender.name + "' tried " + parts[0] + " without admin");
        return true;
    }

    Engine* engine = g_Engine;
    std::string result;

    if (command == "/help") {
        SendToPlayer(sender, "[Server] /kick <player> [reason]");
        SendToPlayer(sender, "[Server] /ban <player> [reason]");
        SendToPlayer(sender, "[Server] /unban <player or SteamID64>");
        SendToPlayer(sender, "[Server] /give <player> <item> [count]");
        return true;
    }

    if (command == "/kick") {
        if (parts.size() < 2) {
            SendToPlayer(sender, "[Server] Usage: /kick <player> [reason]");
            return true;
        }
        std::string reason = parts.size() > 2 ? Join(parts, 2) : "Kicked by an administrator";
        std::string error;
        if (engine->KickPlayer(parts[1], reason, error)) {
            result = "Kicked " + parts[1];
        } else {
            result = "Kick failed: " + error;
        }
    } else if (command == "/ban") {
        if (parts.size() < 2) {
            SendToPlayer(sender, "[Server] Usage: /ban <player> [reason]");
            return true;
        }
        std::string reason = parts.size() > 2 ? Join(parts, 2) : "Banned by an administrator";
        std::string message;
        DomBans::Ban(parts[1], reason, message);
        result = message;
    } else if (command == "/unban") {
        if (parts.size() < 2) {
            SendToPlayer(sender, "[Server] Usage: /unban <player or SteamID64>");
            return true;
        }
        std::string message;
        DomBans::Unban(parts[1], message);
        result = message;
    } else if (command == "/give") {
        if (parts.size() < 3) {
            SendToPlayer(sender, "[Server] Usage: /give <player> <item> [count]");
            return true;
        }
        int32_t count = parts.size() > 3 ? atoi(parts[3].c_str()) : 1;
        std::string message;
        DomItems::GiveItem(parts[1], parts[2], count, message);
        result = message;
    }

    LogMessage("Chat: '" + sender.name + "' ran " + body + " -> " + result);
    SendToPlayer(sender, "[Server] " + result);
    return true;
}

void SendThunk(void* context, void* frame, void* result) {
    Engine* engine = g_Engine;
    bool suppress = false;

    if (engine && engine->IsInitialized() && GameThread::FrameLayoutReady()) {
        uintptr_t locals = Mem::ReadPtr((uintptr_t)frame + GameThread::FrameLocalsOffset());
        if (locals && Mem::Readable((void*)locals, kMessageSize)) {
            Message message;
            message.body = engine->ReadFString(locals + kMessageBody);
            if (!message.body.empty()) {
                message.characterGuid = engine->ReadGuid(locals + kCharacterGuid);
                message.playerId = Mem::ReadI32(locals + kPlayerId);

                std::string source;
                message.senderNetId = engine->ReadUniqueNetId(locals + kSenderId, source);

                PlayerInfo sender;
                bool haveSender = false;
                for (const PlayerInfo& player : engine->GetAllPlayers()) {
                    if (player.playerId != message.playerId) continue;
                    sender = player;
                    haveSender = true;
                    message.senderName =
                        player.characterName.empty() ? player.name : player.characterName;
                    if (message.senderNetId.empty()) message.senderNetId = player.uniqueNetId;
                    break;
                }

                if (haveSender && !message.body.empty() && message.body[0] == '/') {
                    suppress = HandleCommand(sender, message.body);
                }

                if (!suppress) Deliver(message);
            }
        }
    }

    if (!suppress && g_OriginalSend) g_OriginalSend(context, frame, result);
}

struct Wanted {
    const char* className;
    const char* function;
    uintptr_t* slot;
    // Also accepted on another class whose name contains this, for when a game
    // update renames the class.
    const char* looseOuter;
    std::string fallbackOuter;
    uintptr_t fallback = 0;
};

// One pass over GObjects for every function still missing.
void FindMissing(std::vector<Wanted>& wanted, bool logCandidates) {
    Engine* engine = g_Engine;
    int logged = 0;
    int32_t count = engine->GetObjectCount();
    for (int32_t i = 0; i < count; i++) {
        uintptr_t object = engine->GetObjectByIndex(i);
        if (!object) continue;
        std::string name = engine->GetObjectName(object);

        bool interesting = false;
        for (const Wanted& w : wanted) interesting |= name == w.function;
        bool candidate = logCandidates && logged < 30 &&
                         (name.find("ChatMessage") != std::string::npos ||
                          name.find("OwnerOrAdmin") != std::string::npos);
        if (!interesting && !candidate) continue;
        if (engine->GetObjectClassName(object) != "Function") continue;

        std::string outer = engine->GetObjectName(Mem::ReadPtr(object + Offsets::UObject_Outer));
        if (candidate) {
            LogMessage("Chat:   candidate " + outer + "." + name);
            logged++;
        }
        for (Wanted& w : wanted) {
            if (name != w.function || *w.slot) continue;
            if (outer == w.className) {
                *w.slot = object;
            } else if (!w.fallback && outer.find(w.looseOuter) != std::string::npos) {
                w.fallback = object;
                w.fallbackOuter = outer;
            }
        }
    }

    for (Wanted& w : wanted) {
        if (*w.slot || !w.fallback) continue;
        *w.slot = w.fallback;
        LogMessage("Chat: " + std::string(w.function) + " found on " + w.fallbackOuter + " (expected " +
                   w.className + ")");
    }
}

bool InstallSendHook() {
    uintptr_t original = Mem::ReadPtr(g_SendFunction + kExecFunction);
    if (!original || !Mem::InImage((void*)original)) {
        g_Status = "Server_SendChatMessage has no usable thunk";
        return false;
    }
    g_OriginalSend = (ExecThunk)original;
    *(uintptr_t*)(g_SendFunction + kExecFunction) = (uintptr_t)&SendThunk;
    g_Hooked = true;
    g_Status = "hooked";
    LogMessage("Chat: reading messages from PlayerChatComponent.Server_SendChatMessage" +
               std::string(g_Lookups > 1 ? " (found on try " + std::to_string(g_Lookups) + ")" : ""));
    return true;
}

// Looks up whatever is still missing. Runs at start, then from Poll every 10s for
// the first ten minutes and every minute after that, until everything is found.
void Lookup() {
    Engine* engine = g_Engine;
    if (g_LookupDone || !engine || !engine->IsInitialized()) return;

    auto now = Clock::now();
    if (g_Lookups && now < g_NextLookup) return;
    if (!g_Lookups) g_FirstLookup = now;
    g_Lookups++;
    g_NextLookup = now + (now - g_FirstLookup < std::chrono::minutes(10) ? std::chrono::seconds(10)
                                                                          : std::chrono::seconds(60));

    bool hadReceive = g_ReceiveFunction != 0;
    bool hadAdmin = g_AdminFunction && g_AdminLibrary;

    std::vector<Wanted> wanted;
    auto want = [&](const char* className, const char* function, uintptr_t* slot, const char* looseOuter) {
        if (!*slot) wanted.push_back({className, function, slot, looseOuter, "", 0});
    };
    want("PlayerChatComponent", "Server_SendChatMessage", &g_SendFunction, "Chat");
    want("PlayerChatComponent", "Client_ReceiveChatMessage", &g_ReceiveFunction, "Chat");
    want("PlayerChatComponent", "Client_ReceivePlayerEvent", &g_ClientEventFunction, "Chat");
    want("PlayerChatComponent", "Server_SendPlayerEvent", &g_ServerEventFunction, "Chat");
    want("PlayerChatComponent", "Client_ReceiveSystemMessage", &g_SystemMessageFunction, "Chat");
    want("PrivilegeFunctionLibrary", "ControllerIsOwnerOrAdmin", &g_AdminFunction, "");

    // Still missing after two minutes: list what the game has instead, once.
    bool logCandidates = !g_CandidatesLogged && now - g_FirstLookup >= std::chrono::minutes(2) &&
                         (!g_SendFunction || !g_ReceiveFunction || !g_AdminFunction);
    if (logCandidates) {
        g_CandidatesLogged = true;
        LogMessage("Chat: functions still missing after 2 minutes; similar ones in the game:");
    }
    if (!wanted.empty()) FindMissing(wanted, logCandidates);

    // The library object is the default object of whichever class has the function.
    if (g_AdminFunction && !g_AdminLibrary) {
        std::string library = engine->GetObjectName(Mem::ReadPtr(g_AdminFunction + Offsets::UObject_Outer));
        g_AdminLibrary = engine->FindObject(library.c_str(), true);
    }

    if (!g_Hooked && g_SendFunction) InstallSendHook();
    if (!g_Hooked && !g_SendFunction) {
        g_Status = "Server_SendChatMessage not found yet - still looking (try " + std::to_string(g_Lookups) + ")";
    }

    if (g_Lookups == 1) {
        if (!g_SendFunction) LogMessage("Chat: Server_SendChatMessage not loaded yet, will keep looking");
        if (!g_ReceiveFunction) LogMessage("Chat: Client_ReceiveChatMessage not loaded yet, will keep looking");
        if (!g_AdminFunction || !g_AdminLibrary) LogMessage("Chat: ControllerIsOwnerOrAdmin not loaded yet, will keep looking");
    } else {
        if (!hadReceive && g_ReceiveFunction) {
            LogMessage("Chat: Client_ReceiveChatMessage found on try " + std::to_string(g_Lookups) + ", broadcast is live");
        }
        if (!hadAdmin && g_AdminFunction && g_AdminLibrary) {
            LogMessage("Chat: ControllerIsOwnerOrAdmin found on try " + std::to_string(g_Lookups) +
                       ", chat commands are live");
        }
    }

    g_LookupDone = g_Hooked && g_ReceiveFunction && g_AdminFunction && g_AdminLibrary &&
                   (g_ClientEventFunction || g_ServerEventFunction);
    if (g_LookupDone && g_Lookups > 1) LogMessage("Chat: everything found");
}

}

bool IsHooked() { return g_Hooked; }
const std::string& Status() { return g_Status; }

bool CanBroadcast() { return g_ReceiveFunction != 0; }
bool CanCheckAdmin() { return g_AdminFunction != 0 && g_AdminLibrary != 0; }
bool StillLooking() { return !g_LookupDone && g_Lookups > 0; }

int ChatComponentState(std::string& detail) {
    if (g_ChatComponentVerified) {
        detail = "at controller +" + HexString(g_ChatComponentOffset);
        if (g_ChatComponentOffset != kControllerChatComponent) {
            detail += " (moved from the SDK's +" + HexString(kControllerChatComponent) + ", found by scanning)";
        }
        return 1;
    }
    if (g_ChatComponentMissingLogged) {
        detail = "no PlayerChatComponent on the player controller";
        return 0;
    }
    detail = "checked once someone is online";
    return -1;
}

void AddListener(Listener listener) {
    std::lock_guard<std::mutex> lock(g_ListenerMutex);
    g_Listeners.push_back(listener);
}

void AddEventListener(EventListener listener) {
    std::lock_guard<std::mutex> lock(g_ListenerMutex);
    g_EventListeners.push_back(listener);
}

void Poll() {
    Engine* engine = g_Engine;
    if (!engine || !engine->IsInitialized()) return;
    Lookup();

    bool watchEvents = (g_ClientEventFunction || g_ServerEventFunction || g_SystemMessageFunction) &&
                       GameThread::VTableIndex() >= 0;

    for (const PlayerInfo& player : engine->GetAllPlayers()) {
        if (!player.controllerPtr) continue;
        uintptr_t component = ChatComponentOf(player.controllerPtr);
        if (!component || !watchEvents) continue;
        uintptr_t vtable = Mem::ReadPtr(component);
        if (!vtable) continue;

        {
            std::lock_guard<std::mutex> lock(g_VTableMutex);
            if (g_HookedVTables.count(vtable)) continue;
        }

        GameThread::ProcessEventFn previous = nullptr;
        if (!GameThread::HookVTable(component, &HookedChatProcessEvent, previous)) continue;
        if (!previous) continue;

        {
            std::lock_guard<std::mutex> lock(g_VTableMutex);
            g_HookedVTables[vtable] = previous;
        }
        LogMessage("Chat: watching player events on " + engine->GetObjectClassName(component));
    }
}

// Anything not loaded yet is looked for again from Poll.
bool Initialize() {
    Engine* engine = g_Engine;
    if (!engine || !engine->IsInitialized()) {
        g_Status = "engine not initialised";
        return false;
    }
    Lookup();
    return g_Hooked;
}

bool Whisper(const PlayerInfo& player, const std::string& body) {
    if (!g_ReceiveFunction || !GameThread::IsReady() || !GameThread::HasProcessEvent() || body.empty()) return false;
    bool sent = false;
    bool ran = GameThread::RunSync([&]() { sent = SendToPlayer(player, body); }, 5000);
    return ran && sent;
}

bool IsPlayerAdmin(const PlayerInfo& player) {
    if (!GameThread::IsReady() || !GameThread::FrameLayoutReady()) return false;
    bool admin = false;
    bool ran = GameThread::RunSync([&]() { admin = IsAdmin(player.controllerPtr); }, 5000);
    return ran && admin;
}

bool Broadcast(const std::string& body, std::string& outError) {
    Engine* engine = g_Engine;
    if (!engine || !engine->IsInitialized()) {
        outError = "engine not initialised";
        return false;
    }
    if (!g_ReceiveFunction) {
        outError = "Client_ReceiveChatMessage not found";
        return false;
    }
    if (!GameThread::IsReady()) {
        outError = "broadcast needs the game thread pump: " + GameThread::Status();
        return false;
    }
    if (body.empty()) {
        outError = "message is empty";
        return false;
    }

    std::vector<PlayerInfo> players = engine->GetAllPlayers();
    if (players.empty()) {
        outError = "no players to broadcast to";
        return false;
    }

    // Without a ProcessEvent symbol it is learned from the first ServerUpdateCamera
    // a client sends, i.e. shortly after the first player joins.
    if (!GameThread::HasProcessEvent()) {
        outError = "broadcast needs ProcessEvent, which is found once a player has been in "
                   "game since the server started";
        return false;
    }

    int delivered = 0;
    bool ran = GameThread::RunSync([&]() {
        for (const PlayerInfo& player : players) {
            if (SendToPlayer(player, body)) delivered++;
        }
    }, 10000);

    if (!ran) {
        outError = "the game thread did not run the broadcast within 10s";
        return false;
    }
    if (!delivered) {
        outError = "the game accepted no recipients";
        return false;
    }

    LogMessage("Chat: broadcast to " + std::to_string(delivered) + " player(s): " + body);
    return true;
}

}
