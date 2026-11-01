#pragma once
#include <cstdint>
#include <string>
#include <vector>

// The world itself: its name and settings, and raid and hunted events while
// they run. For GET /api/world.
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

    std::vector<EventInfo> events;

    // How many quests (shown in the quest list) and journal entries the game
    // has loaded - the most a player can have. 0 if unknown.
    int32_t totalQuests = 0;
    int32_t totalJournal = 0;
};

State Read();

}
