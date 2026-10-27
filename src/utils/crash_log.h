#pragma once
#include <string>

namespace CrashLog {

// Appends a backtrace to `path` when the server dies of SIGSEGV, SIGBUS, SIGILL,
// SIGFPE or SIGABRT, then hands the signal to whoever handled it before (the
// game's own crash reporter). Install after the engine is up, so the game's
// handler is already in place to chain to.
void Install(const std::string& path);

// Resident memory of the server process in MB, or -1.
long ResidentMegabytes();

}
