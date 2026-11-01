#pragma once
#include <string>

namespace CrashLog {

// Appends a backtrace to `path` when the server dies of SIGSEGV, SIGBUS, SIGILL,
// SIGFPE or SIGABRT, then hands the signal to whoever handled it before (the
// game's own crash reporter). Install after the engine is up, so the game's
// handler is already in place to chain to.
void Install(const std::string& path);

// Whether a crash signal arrived: the game's crash reporter ends with exit(),
// which would otherwise log a normal shutdown.
bool Crashed();

// What the mod is doing on the game thread right now, for the crash report:
// a crash while one is alive happened inside the mod's own code there.
class Activity {
public:
    explicit Activity(const char* what);
    ~Activity();
    Activity(const Activity&) = delete;
    Activity& operator=(const Activity&) = delete;

private:
    const char* previous;
};

// Resident memory of the server process in MB, or -1.
long ResidentMegabytes();

}
