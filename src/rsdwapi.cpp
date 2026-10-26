#include "api/api_routes.h"
#include "config/config.h"
#include "engine/bans.h"
#include "engine/chat.h"
#include "engine/dom_engine.h"
#include "engine/native_call.h"
#include "engine/process_event.h"
#include "events/event_log.h"
#include "http/http_server.h"
#include "rcon/rcon_commands.h"
#include "rcon/rcon_server.h"
#include "runtime.h"
#include "utils/logger.h"
#include "utils/memory.h"

#include <algorithm>
#include <atomic>
#include <cstdlib>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <map>
#include <mutex>
#include <sys/stat.h>
#include <thread>
#include <utility>

APIConfig g_Config;

namespace {

HttpServer* g_HttpServer = nullptr;
Rcon::Server* g_RconServer = nullptr;
std::thread* g_InitThread = nullptr;
std::atomic<bool> g_Shutdown{false};
std::atomic<bool> g_StoppedCleanly{false};

void ShutdownListeners() {
    if (g_StoppedCleanly.exchange(true)) return;
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
// chmod, dirname) and anything the server spawns. Left alone, each of those
// binds the API port first, rotates the log and rewrites settings.ini. Only the
// game server process itself carries on.
bool GameImageMapped() {
    FILE* maps = fopen("/proc/self/maps", "r");
    if (!maps) return false;

    bool found = false;
    char line[4096];
    while (!found && fgets(line, sizeof(line), maps)) {
        if (strstr(line, "RSDragonwilds") && !strstr(line, "librsdwapi") && !strstr(line, ".sh")) {
            found = true;
        }
    }
    fclose(maps);
    return found;
}

// The server binary is well over 100MB; shells and curl are a few MB at most.
bool ExecutableIsGameSized() {
    struct stat st;
    return stat("/proc/self/exe", &st) == 0 && st.st_size >= 64ll * 1024 * 1024;
}

bool IsGameServerProcess() {
    const char* force = getenv("RSDWAPI_FORCE");
    if (force && *force && strcmp(force, "0") != 0) return true;
    if (ExecutableIsGameSized()) return true;

    // A launcher stub may map the game a moment after we load, so allow a minute.
    for (int i = 0; i < 120 && !g_Shutdown; i++) {
        if (GameImageMapped()) return true;
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
    }
    return false;
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
        std::map<std::string, std::chrono::steady_clock::time_point> deathPosted;
        std::mutex deathMutex;

        auto reportDeath = [&](const std::string& key, const std::string& name, const std::string& where,
                               const std::string& netId) {
            auto now = std::chrono::steady_clock::now();
            {
                std::lock_guard<std::mutex> lock(deathMutex);
                auto it = deathPosted.find(key);
                if (it != deathPosted.end() && now - it->second < std::chrono::seconds(10)) return;
                deathPosted[key] = now;
            }
            LogMessage("Deaths: " + name + " died" + (where.empty() ? "" : " at " + where));

            EventLog::Event event;
            event.type = "death";
            event.name = name;
            event.netId = netId;
            event.location = where;
            EventLog::Push(std::move(event));
        };

        DomChat::AddEventListener([&](const DomChat::PlayerEvent& event) {
            std::string tag = event.tag;
            std::transform(tag.begin(), tag.end(), tag.begin(),
                           [](unsigned char c) { return (char)tolower(c); });
            if (tag.find("death") == std::string::npos && tag.find("died") == std::string::npos &&
                tag.find("die") == std::string::npos) {
                return;
            }
            std::string name = event.senderName.empty() ? "playerId " + std::to_string(event.playerId)
                                                        : event.senderName;
            std::string key = event.senderNetId.empty() ? std::to_string(event.playerId) : event.senderNetId;
            std::string where;
            for (const DomEngine::PlayerInfo& player : DomEngine::g_Engine->GetAllPlayers()) {
                if (player.playerId != event.playerId) continue;
                if (!player.hasLocation) break;
                char buffer[96];
                snprintf(buffer, sizeof(buffer), "%.0f, %.0f, %.0f", player.x, player.y, player.z);
                where = buffer;
                break;
            }
            reportDeath(key, name, where, event.senderNetId);
        });

        while (!g_Shutdown) {
            for (int i = 0; i < 20 && !g_Shutdown; i++) {
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
            }
            if (g_Shutdown) break;

            DomEngine::g_Engine->EnforceKicks();
            DomBans::Enforce();
            DomChat::Poll();

            std::map<std::string, bool> nowDead;
            for (const DomEngine::PlayerInfo& player : DomEngine::g_Engine->GetAllPlayers()) {
                if (player.uniqueNetId.empty() || !player.hasHealth) continue;
                nowDead[player.uniqueNetId] = player.isDead;

                auto previous = wasDead.find(player.uniqueNetId);
                bool justDied = player.isDead && previous != wasDead.end() && !previous->second;
                if (!justDied) continue;

                std::string name = player.characterName.empty() ? player.name : player.characterName;
                char where[96];
                snprintf(where, sizeof(where), "%.0f, %.0f, %.0f", player.x, player.y, player.z);
                reportDeath(player.uniqueNetId, name, where, player.uniqueNetId);
            }
            wasDead.swap(nowDead);
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
