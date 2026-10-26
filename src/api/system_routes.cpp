#include "api_routes.h"

#include "../events/event_log.h"
#include "../runtime.h"

#include <cstdio>
#include <cstdlib>
#include <sstream>

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
                << ",\"location\":" << q(e.location) << "}";
        }
        oss << "]}";
        return JsonResponse(oss.str());
    });
}

}
