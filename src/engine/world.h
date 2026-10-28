#pragma once
#include <cstdint>
#include <string>
#include <vector>

// The world itself: its name and settings, the in-game clock, and raid and
// hunted events while they run. For GET /api/world.
namespace DomWorld {

struct EventInfo {
    std::string id;   // stable while the event runs
    std::string type; // raid or hunted
    std::string name; // the event's class, e.g. BP_RaidEvent_Goblins_C
    bool hasLocation = false;
    double x = 0, y = 0, z = 0;
    double radius = 0; // how far from it players count as caught up in it, 0 if unknown
};

struct State {
    bool valid = false;
    std::string worldName;
    std::string host;
    std::string difficulty; // normal, hard, creative, custom, or ""
    std::string hardcore;   // off, active, failed, succeeded, or ""

    bool hasTime = false;
    int32_t day = 0;     // 1 on the first day
    double hour = 0;     // 0-24, time of day
    double dawn = 6, dusk = 20;
    bool isDay = false;
    bool paused = false;
    int32_t minutesPerDay = 0; // real minutes in an in-game day, 0 if unknown

    std::vector<EventInfo> events;
};

State Read();

}
