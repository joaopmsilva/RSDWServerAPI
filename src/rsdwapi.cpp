#include "api/api_routes.h"
#include "api/serialize.h"
#include "config/config.h"
#include "engine/bans.h"
#include "engine/chat.h"
#include "engine/kills.h"
#include "engine/dom_engine.h"
#include "engine/game_settings.h"
#include "engine/native_call.h"
#include "engine/process_event.h"
#include "events/event_log.h"
#include "http/http_server.h"
#include "rcon/rcon_commands.h"
#include "rcon/rcon_server.h"
#include "runtime.h"
#include "utils/crash_log.h"
#include "utils/logger.h"
#include "utils/memory.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdlib>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <map>
#include <mutex>
#include <sys/stat.h>
#include <thread>
#include <utility>
#include <vector>

APIConfig g_Config;

namespace {

HttpServer* g_HttpServer = nullptr;
Rcon::Server* g_RconServer = nullptr;
std::thread* g_InitThread = nullptr;
std::atomic<bool> g_Shutdown{false};
std::atomic<bool> g_StoppedCleanly{false};

void ShutdownListeners() {
    if (g_StoppedCleanly.exchange(true)) return;
    // A log that ends without this line means the server crashed or was killed.
    // The game's crash reporter ends with exit() too, which lands here.
    if (CrashLog::Crashed()) LogMessage("RSDWRestAPI: server crashed - see crash.log");
    else LogMessage("RSDWRestAPI: server is shutting down normally");
    g_Shutdown = true;

    if (g_HttpServer) g_HttpServer->Stop();
    if (g_RconServer) g_RconServer->Stop();

    if (g_InitThread && g_InitThread->joinable()) g_InitThread->join();

    Runtime::BeginShutdown();
}

void StartListeners() {
    if (g_Config.rest.enabled) {
        g_HttpServer = new HttpServer();
        g_HttpServer->SetIpWhitelist(g_Config.rest.ipWhitelist);
        ApiRoutes::RegisterAll(*g_HttpServer);
        if (g_Config.rest.bearerToken.empty()) {
            LogMessage("RSDWRestAPI: REST bearer token is empty - the API is UNAUTHENTICATED. "
                       "Bind to 127.0.0.1 or set IPWhitelist unless that is intended.");
        }
        bool running = g_HttpServer->Start(g_Config.rest.port, g_Config.rest.bindAddress);
        Runtime::SetRestState(true, running, g_Config.rest.port);
        if (!running) LogMessage("RSDWRestAPI: REST listener failed to start");
    } else {
        Runtime::SetRestState(false, false, g_Config.rest.port);
        LogMessage("RSDWRestAPI: REST API disabled by settings.ini");
    }

    if (g_Config.rcon.enabled) {
        Rcon::RegisterAll();
        g_RconServer = new Rcon::Server();
        bool running = g_RconServer->Start(g_Config.rcon);
        Runtime::SetRconState(true, running, g_Config.rcon.port);
        if (!running) LogMessage("RSDWRestAPI: RCON listener failed to start");
    } else {
        Runtime::SetRconState(false, false, g_Config.rcon.port);
        LogMessage("RSDWRestAPI: RCON disabled by settings.ini");
    }
}

// LD_PRELOAD is inherited by everything the launch script runs (its own shell,
// chmod, dirname) and anything the server spawns - like the crash reporter
// (Sentry's crashpad_handler, which lives under the game's folder). Left alone,
// each of those binds the API port first, rotates the log and rewrites
// settings.ini. Only the game server process itself carries on: the server
// binary is well over 100MB, the rest a few MB at most.
bool IsGameServerProcess() {
    const char* force = getenv("RSDWAPI_FORCE");
    if (force && *force && strcmp(force, "0") != 0) return true;
    struct stat st;
    return stat("/proc/self/exe", &st) == 0 && st.st_size >= 64ll * 1024 * 1024;
}

// Deaths: each is posted once, from whichever sees it first - the game's own
// death event or the health check. Kept here rather than on the init thread's
// stack, as the event listener holding them outlives no thread but must not
// point into one.
std::mutex g_DeathMutex;
std::map<std::string, std::chrono::steady_clock::time_point> g_DeathPosted;

// Pushes a death with what killed them, read from their damage component.
void ReportDeath(const std::string& key, int32_t playerId, const std::string& netId) {
    auto now = std::chrono::steady_clock::now();
    {
        std::lock_guard<std::mutex> lock(g_DeathMutex);
        auto it = g_DeathPosted.find(key);
        if (it != g_DeathPosted.end() && now - it->second < std::chrono::seconds(10)) return;
        g_DeathPosted[key] = now;
    }

    std::vector<DomEngine::PlayerInfo> players = DomEngine::g_Engine->CachedPlayers();
    EventLog::Event event;
    event.type = "death";
    event.netId = netId;
    for (const DomEngine::PlayerInfo& player : players) {
        if (player.playerId != playerId && (netId.empty() || player.uniqueNetId != netId)) continue;
        event.name = player.characterName.empty() ? player.name : player.characterName;
        if (event.netId.empty()) event.netId = player.uniqueNetId;
        if (player.hasLocation) {
            char where[96];
            snprintf(where, sizeof(where), "%.0f, %.0f, %.0f", player.x, player.y, player.z);
            event.location = where;
        }
        // cause: creature (message: its class), player (message: their name),
        // self (a fall, drowning...), other, or "" when the game didn't say.
        DomKills::KillerOf(player, players, event.cause, event.message);
        break;
    }
    if (event.name.empty()) event.name = "playerId " + std::to_string(playerId);

    LogMessage("Deaths: " + event.name + " died" + (event.location.empty() ? "" : " at " + event.location) +
               (event.cause.empty() ? "" : " (" + event.cause + (event.message.empty() ? "" : ": " + event.message) + ")"));
    EventLog::Push(std::move(event));
}

// AFK: a player who hasn't moved or looked around for [AFK] KickMinutes gets a
// private warning WarnMinutes before, then is kicked. The kick isn't
// remembered, so they can rejoin straight away. Called every two seconds.
struct AfkState {
    double x = 0, y = 0, z = 0, yaw = 0, pitch = 0;
    std::chrono::steady_clock::time_point active;
    std::chrono::steady_clock::time_point warnedAt;
    bool warned = false;
};
std::map<std::string, AfkState> g_Afk;

void CheckAfk(const std::vector<DomEngine::PlayerInfo>& players) {
    const AfkConfig& cfg = g_Config.afk;
    if (cfg.kickMinutes <= 0) {
        g_Afk.clear();
        return;
    }

    using Clock = std::chrono::steady_clock;
    auto now = Clock::now();
    auto minutesSince = [&](Clock::time_point t) { return std::chrono::duration<double>(now - t).count() / 60.0; };
    bool full = !cfg.onlyWhenFull || (cfg.maxPlayers > 0 && (int)players.size() >= cfg.maxPlayers);
    int warnMinutes = std::max(cfg.warnMinutes, 0);
    double warnAt = std::max(cfg.kickMinutes - warnMinutes, 0);

    std::map<std::string, AfkState> next;
    for (const DomEngine::PlayerInfo& player : players) {
        if (player.uniqueNetId.empty() || !player.hasLocation) continue;
        std::string name = player.characterName.empty() ? player.name : player.characterName;

        auto it = g_Afk.find(player.uniqueNetId);
        bool moved = it == g_Afk.end() ||
                     std::fabs(player.x - it->second.x) + std::fabs(player.y - it->second.y) +
                             std::fabs(player.z - it->second.z) > 50.0 ||
                     std::fabs(player.yaw - it->second.yaw) > 1.0 || std::fabs(player.pitch - it->second.pitch) > 1.0;
        AfkState state = moved ? AfkState{} : it->second;
        if (moved) {
            state.x = player.x, state.y = player.y, state.z = player.z;
            state.yaw = player.yaw, state.pitch = player.pitch;
            state.active = now;
            if (it != g_Afk.end() && it->second.warned) DomChat::Whisper(player, "[Server] Welcome back - you won't be kicked.");
        }

        double idle = minutesSince(state.active);
        if (full && idle >= warnAt) {
            if (cfg.exemptAdmins && DomChat::IsPlayerAdmin(player)) {
                state.active = now;
                state.warned = false;
                next[player.uniqueNetId] = state;
                continue;
            }

            bool warningDone = !warnMinutes || (state.warned && minutesSince(state.warnedAt) >= warnMinutes);
            if (idle >= cfg.kickMinutes && warningDone) {
                std::string error;
                if (DomEngine::g_Engine->KickPlayer(player.uniqueNetId, "Kicked for being AFK", error)) {
                    DomEngine::g_Engine->ClearKick(player.uniqueNetId);
                    LogMessage("AFK: kicked " + name + " after " + std::to_string((int)idle) + " min idle");
                    EventLog::Event event;
                    event.type = "afk";
                    event.name = name;
                    event.netId = player.uniqueNetId;
                    EventLog::Push(std::move(event));
                } else {
                    LogMessage("AFK: could not kick " + name + ": " + error);
                }
                continue;
            }

            if (!state.warned && warnMinutes) {
                state.warned = true;
                state.warnedAt = now;
                DomChat::Whisper(player, "[Server] You'll be kicked for being AFK in " + std::to_string(warnMinutes) +
                                             " minute" + (warnMinutes == 1 ? "" : "s") + " - move to stay.");
                LogMessage("AFK: warned " + name);
            }
        }
        next[player.uniqueNetId] = state;
    }
    g_Afk.swap(next);
}

void InitThread() {
    if (!IsGameServerProcess()) return;

    Mem::Init();

    APIConfig::EnsureConfigDirectory();
    std::string configPath = APIConfig::GetConfigPath();
    if (!g_Config.Load(configPath)) g_Config.GenerateSecrets();
    g_Config.Save(configPath);

    GetActiveLogPath() = InitLogFile();
    Runtime::MarkStart();

    LogMessage("RSDWRestAPI " + std::string(Runtime::Version()) + " loaded");
    LogMessage("RSDWRestAPI: data directory " + GetBaseDir());

    StartListeners();
    atexit(&ShutdownListeners);

    if (!g_Config.rest.enabled && !g_Config.rcon.enabled) {
        LogMessage("RSDWRestAPI: both listeners are disabled, nothing to do");
        return;
    }

    DomEngine::g_Engine = new DomEngine::Engine();

    for (int attempt = 1; !g_Shutdown && !DomEngine::g_Engine->IsInitialized(); attempt++) {
        if (DomEngine::g_Engine->Initialize()) break;

        int waitSeconds = attempt < 10 ? 1 : (attempt < 30 ? 5 : 30);

        if (attempt == 1) {
            LogMessage("RSDWRestAPI: waiting for the engine to finish loading");
        }

        for (int i = 0; i < waitSeconds * 10 && !g_Shutdown; i++) {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
    }

    if (!g_Shutdown && DomEngine::g_Engine->IsInitialized()) {
        LogMessage("RSDWRestAPI: engine ready, endpoints are live");

        std::string crashLog = GetLogDir() + "/crash.log";
        CrashLog::Install(crashLog);
        LogMessage("RSDWRestAPI: a crash writes its backtrace to " + crashLog);

        NativeCall::LogImageSymbolReport();

        DomEngine::DiscoveryInfo discovery = DomEngine::g_Engine->GetDiscoveryInfo();
        if (!GameThread::Initialize(discovery.moduleBase, discovery.moduleEnd) &&
            !GameThread::InstallExecPump()) {
            LogMessage("RSDWRestAPI: kick disabled - " + GameThread::Status());
            return;
        }

        DomChat::Initialize();

        // Chat and deaths go to the /api/events feed; the Discord bot relays them.
        DomChat::AddListener([](const DomChat::Message& message) {
            EventLog::Event event;
            event.type = "chat";
            event.name = message.senderName.empty() ? "Unknown" : message.senderName;
            event.netId = message.senderNetId;
            event.characterGuid = message.characterGuid;
            event.playerId = message.playerId;
            event.message = message.body;
            LogVerbose("Chat: " + event.name + ": " + event.message);
            EventLog::Push(std::move(event));
        });
        LogMessage("Events: chat and death feed live at /api/events");

        DomBans::Load();

        std::map<std::string, bool> wasDead;

        // The game's death event, delivered from DomChat::Poll on this thread.
        DomChat::AddEventListener([](const DomChat::PlayerEvent& event) {
            std::string tag = event.tag;
            std::transform(tag.begin(), tag.end(), tag.begin(),
                           [](unsigned char c) { return (char)tolower(c); });
            if (tag.find("death") == std::string::npos && tag.find("died") == std::string::npos &&
                tag.find("die") == std::string::npos) {
                return;
            }
            std::string key = event.senderNetId.empty() ? std::to_string(event.playerId) : event.senderNetId;
            ReportDeath(key, event.playerId, event.senderNetId);
        });

        // Join / leave, by net id. A player still loading in has no id or name yet,
        // so they count once both are readable.
        //
        // Characters travel between worlds, so a leave carries what the
        // character had (skills, items) as last seen, and once a returning
        // character has loaded - skills and inventory read the same two ticks
        // running - an "arrive" event carries what they came back with. The bot
        // compares the two.
        struct Presence {
            std::string name;
            DomEngine::PlayerInfo last;
            std::chrono::steady_clock::time_point joinedAt;
            bool arrived = false;
            std::string carried; // the previous tick's, to see it settle
            int steadyTicks = 0;
        };
        std::map<std::string, Presence> wasOnline;
        auto pushPresence = [](const char* type, const std::string& netId, const std::string& name,
                               const std::string& guid, size_t online, std::string data) {
            if (type[0] != 'a') {
                LogMessage(std::string("Players: ") + name + (type[0] == 'j' ? " joined" : " left") + ", " +
                           std::to_string(online) + " online");
            }
            EventLog::Event event;
            event.type = type;
            event.name = name;
            event.netId = netId;
            event.characterGuid = guid;
            event.players = (int32_t)online;
            event.data = std::move(data);
            EventLog::Push(std::move(event));
        };
        auto canCarry = [](const DomEngine::PlayerInfo& p) { return p.spawned && !p.skills.empty() && p.hasInventory; };

        // A line every ten minutes, so the log shows memory climbing before an
        // out-of-memory kill and roughly when a crash happened.
        auto nextHeartbeat = std::chrono::steady_clock::now();

        int tickTenths = g_Config.tickSeconds * 10;
        LogMessage("RSDWRestAPI: checking players every " + std::to_string(g_Config.tickSeconds) + "s");
        while (!g_Shutdown) {
            for (int i = 0; i < tickTenths && !g_Shutdown; i++) {
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
            }
            if (g_Shutdown) break;

            // One scan per tick; everything below, and the API until the next
            // tick, shares it.
            std::vector<DomEngine::PlayerInfo> players = DomEngine::g_Engine->GetAllPlayers(0);

            DomEngine::g_Engine->EnforceKicks();
            DomBans::Enforce();
            DomChat::Poll(players);
            DomGameSettings::Apply();
            DomKills::Scan(players);

            if (std::chrono::steady_clock::now() >= nextHeartbeat) {
                nextHeartbeat += std::chrono::minutes(10);
                LogMessage("Heartbeat: up " + std::to_string((long)(Runtime::UptimeSeconds() / 60)) + " min, " +
                           std::to_string(players.size()) + " online, server using " +
                           std::to_string(CrashLog::ResidentMegabytes()) + " MB");
            }

            auto now = std::chrono::steady_clock::now();
            std::map<std::string, Presence> nowOnline;
            size_t onlineCount = 0;
            for (const DomEngine::PlayerInfo& player : players) {
                std::string name = player.characterName.empty() ? player.name : player.characterName;
                if (!player.uniqueNetId.empty() && !name.empty()) onlineCount++;
            }
            for (const DomEngine::PlayerInfo& player : players) {
                if (player.uniqueNetId.empty()) continue;
                std::string name = player.characterName.empty() ? player.name : player.characterName;
                if (name.empty()) continue;

                auto previous = wasOnline.find(player.uniqueNetId);
                Presence presence;
                if (previous == wasOnline.end()) {
                    presence.joinedAt = now;
                    pushPresence("join", player.uniqueNetId, name, player.characterGuid, onlineCount, "");
                } else {
                    presence = std::move(previous->second);
                }
                presence.name = name;
                // Keep the last full read: a tick where the inventory didn't
                // read shouldn't become what they "left with".
                if (canCarry(player) || !canCarry(presence.last)) presence.last = player;

                if (!presence.arrived && canCarry(player)) {
                    std::string carried = Serialize::Carried(player);
                    presence.steadyTicks = carried == presence.carried ? presence.steadyTicks + 1 : 0;
                    presence.carried = carried;
                    auto since = now - presence.joinedAt;
                    if ((presence.steadyTicks >= 1 && since >= std::chrono::seconds(6)) || since >= std::chrono::seconds(60)) {
                        presence.arrived = true;
                        pushPresence("arrive", player.uniqueNetId, name, player.characterGuid, onlineCount, carried);
                    }
                }
                nowOnline[player.uniqueNetId] = std::move(presence);
            }
            for (const auto& entry : wasOnline) {
                if (nowOnline.count(entry.first)) continue;
                const DomEngine::PlayerInfo& last = entry.second.last;
                // Only once they've arrived: before that, what was read may be a
                // character still loading in.
                std::string data = entry.second.arrived && canCarry(last) ? Serialize::Carried(last) : "";
                pushPresence("leave", entry.first, entry.second.name, last.characterGuid, onlineCount, data);
            }
            wasOnline.swap(nowOnline);

            std::map<std::string, bool> nowDead;
            for (const DomEngine::PlayerInfo& player : players) {
                if (player.uniqueNetId.empty() || !player.hasHealth) continue;
                nowDead[player.uniqueNetId] = player.isDead;

                auto previous = wasDead.find(player.uniqueNetId);
                bool justDied = player.isDead && previous != wasDead.end() && !previous->second;
                if (!justDied) continue;
                ReportDeath(player.uniqueNetId, player.playerId, player.uniqueNetId);
            }
            wasDead.swap(nowDead);

            CheckAfk(players);
        }
    }
}

}

extern "C" __attribute__((constructor)) void RSDWApiLoad() {
    g_InitThread = new std::thread(InitThread);
}

extern "C" __attribute__((destructor)) void RSDWApiUnload() {
    g_Shutdown = true;
    Runtime::BeginShutdown();
}
