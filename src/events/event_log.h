#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

// In-memory feed of chat and death events, read through GET /api/events.
// Ids start at 1 each boot; BootId tells a reader the server restarted.
namespace EventLog {

struct Event {
    uint64_t id = 0;
    int64_t timeMs = 0;
    std::string type;
    std::string name;
    std::string netId;
    std::string characterGuid;
    int32_t playerId = 0;
    std::string message;
    std::string location;
};

void Push(Event event);

// Events newer than afterId, oldest first.
std::vector<Event> Since(uint64_t afterId, size_t limit);

uint64_t LatestId();
int64_t BootId();

}
