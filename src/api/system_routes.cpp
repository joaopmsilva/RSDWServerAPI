#include "api_routes.h"

#include "../engine/chat.h"
#include "../engine/process_event.h"
#include "../events/event_log.h"
#include "../runtime.h"

#include <cstdio>
#include <cstdlib>
#include <sstream>
#include <vector>

namespace ApiRoutes {

void RegisterSystem(HttpServer& server) {
    server.Get("/api/hello", [](const HttpRequest&) -> HttpResponse {
        return JsonResponse(R"({"message":"Hello from RSDWRestAPI!","status":"ok"})");
    });

    server.Get("/api/health", [](const HttpRequest&) -> HttpResponse {
        bool ready = EngineReady();

        char uptime[32];
        snprintf(uptime, sizeof(uptime), "%.1f", Runtime::UptimeSeconds());

        std::ostringstream oss;
        oss << "{"
            << "\"status\":\"" << (ready ? "healthy" : "starting") << "\","
            << "\"version\":\"" << Runtime::Version() << "\","
            << "\"uptimeSeconds\":" << uptime << ","
            << "\"engineReady\":" << (ready ? "true" : "false")
            << "}";
        return JsonResponse(oss.str());
    });

    server.Get("/api/events", [](const HttpRequest& req) -> HttpResponse {
        uint64_t since = 0;
        size_t limit = 100;

        auto it = req.query.find("since");
        if (it != req.query.end()) since = strtoull(it->second.c_str(), nullptr, 10);
        it = req.query.find("limit");
        if (it != req.query.end()) {
            long value = atol(it->second.c_str());
            if (value > 0) limit = value > 500 ? 500 : (size_t)value;
        }

        auto events = EventLog::Since(since, limit);

        auto q = [](const std::string& value) { return "\"" + Json::Escape(value) + "\""; };

        std::ostringstream oss;
        oss << "{\"bootId\":" << EventLog::BootId() << ",\"latestId\":" << EventLog::LatestId() << ",\"events\":[";
        for (size_t i = 0; i < events.size(); i++) {
            const EventLog::Event& e = events[i];
            if (i) oss << ",";
            oss << "{\"id\":" << e.id
                << ",\"time\":" << e.timeMs
                << ",\"type\":" << q(e.type)
                << ",\"name\":" << q(e.name)
                << ",\"netId\":" << q(e.netId)
                << ",\"characterGuid\":" << q(e.characterGuid)
                << ",\"playerId\":" << e.playerId
                << ",\"message\":" << q(e.message)
                << ",\"location\":" << q(e.location)
                << ",\"cause\":" << q(e.cause)
                << ",\"players\":" << e.players << "}";
        }
        oss << "]}";
        return JsonResponse(oss.str());
    });

    // A self-check of what the mod reads from the game, so a game update that
    // moves something shows up here instead of a feature quietly doing nothing.
    // ok is true, false, or null when it can't be checked yet (nobody online).
    server.Get("/api/diagnostics", [](const HttpRequest&) -> HttpResponse {
        struct Check {
            std::string name;
            int state;
            std::string detail;
        };
        std::vector<Check> checks;
        auto add = [&](const std::string& name, int state, const std::string& detail) {
            checks.push_back({name, state, detail});
        };

        if (!EngineReady()) {
            add("engine", 0, "not found yet - still loading, or a game update moved GNames / GObjects");
        } else {
            DomEngine::DiscoveryInfo d = DomEngine::g_Engine->GetDiscoveryInfo();
            bool scanned = d.gNamesSource != "sdk-offset" || d.gObjectsSource != "sdk-offset";
            add("engine", 1, std::to_string(d.objectCount) + " objects" +
                                 (scanned ? " (found by scanning; the SDK offsets are out of date)" : ""));

            add("gameThread", GameThread::IsReady() ? 1 : 0, GameThread::Status());
            add("processEvent", GameThread::HasProcessEvent() ? 1 : -1,
                GameThread::HasProcessEvent() ? "found" : "learned once a player has joined");
            add("chatHook", DomChat::IsHooked() ? 1 : 0, DomChat::Status());
            add("broadcast", DomChat::CanBroadcast() ? 1 : 0,
                DomChat::CanBroadcast() ? "Client_ReceiveChatMessage found" : "Client_ReceiveChatMessage not found");
            add("adminCheck", DomChat::CanCheckAdmin() ? 1 : 0,
                DomChat::CanCheckAdmin() ? "ControllerIsOwnerOrAdmin found" : "ControllerIsOwnerOrAdmin not found");

            std::string componentDetail;
            int componentState = DomChat::ChatComponentState(componentDetail);
            add("chatComponent", componentState, componentDetail);

            std::vector<DomEngine::PlayerInfo> players = DomEngine::g_Engine->GetAllPlayers();
            if (players.empty()) {
                add("players", -1, "checked once someone is online");
            } else {
                size_t named = 0, ids = 0, skills = 0, health = 0, located = 0;
                for (const DomEngine::PlayerInfo& p : players) {
                    if (!p.name.empty()) named++;
                    if (!p.uniqueNetId.empty()) ids++;
                    if (!p.skills.empty()) skills++;
                    if (p.hasHealth && p.maxHealth > 0) health++;
                    if (p.hasLocation) located++;
                }
                size_t n = players.size();
                std::string of = "/" + std::to_string(n);
                add("playerNames", named == n ? 1 : 0, std::to_string(named) + of + " readable");
                add("playerIds", ids == n ? 1 : 0, std::to_string(ids) + of + " readable");
                add("playerSkills", skills == n ? 1 : 0, std::to_string(skills) + of + " have skills");
                add("playerHealth", health == n ? 1 : 0, std::to_string(health) + of + " have health");
                add("playerLocation", located == n ? 1 : 0, std::to_string(located) + of + " have a location");
            }
        }

        std::ostringstream oss;
        oss << "{\"version\":\"" << Runtime::Version() << "\",\"checks\":[";
        for (size_t i = 0; i < checks.size(); i++) {
            const Check& c = checks[i];
            if (i) oss << ",";
            oss << "{\"name\":\"" << Json::Escape(c.name) << "\",\"ok\":"
                << (c.state > 0 ? "true" : c.state == 0 ? "false" : "null")
                << ",\"detail\":\"" << Json::Escape(c.detail) << "\"}";
        }
        oss << "]}";
        return JsonResponse(oss.str());
    });
}

}
