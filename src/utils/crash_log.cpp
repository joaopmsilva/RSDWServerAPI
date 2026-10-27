#include "crash_log.h"

#include <csignal>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <dlfcn.h>
#include <execinfo.h>
#include <link.h>
#include <fcntl.h>
#include <sys/syscall.h>
#include <ucontext.h>
#include <unistd.h>

namespace CrashLog {

namespace {

constexpr int kSignals[] = {SIGSEGV, SIGBUS, SIGILL, SIGFPE, SIGABRT};

char g_Path[1024];
struct sigaction g_Previous[NSIG];
volatile sig_atomic_t g_Entered = 0;

// Where librsdwapi.so is mapped, to tell the mod's own frames apart.
uintptr_t g_ModStart = 0;
uintptr_t g_ModEnd = 0;

int ModPhdrCallback(struct dl_phdr_info* info, size_t, void* data) {
    uintptr_t base = *(uintptr_t*)data;
    if ((uintptr_t)info->dlpi_addr != base) return 0;
    for (int i = 0; i < info->dlpi_phnum; i++) {
        const ElfW(Phdr)& phdr = info->dlpi_phdr[i];
        if (phdr.p_type != PT_LOAD) continue;
        uintptr_t begin = base + (uintptr_t)phdr.p_vaddr;
        uintptr_t stop = begin + (uintptr_t)phdr.p_memsz;
        if (!g_ModStart || begin < g_ModStart) g_ModStart = begin;
        if (stop > g_ModEnd) g_ModEnd = stop;
    }
    return 1;
}

bool InMod(uintptr_t address) {
    return g_ModStart && address >= g_ModStart && address < g_ModEnd;
}

// Only async-signal-safe calls from here on: no malloc, no stdio.
void Write(int fd, const char* text) {
    size_t left = strlen(text);
    while (left) {
        ssize_t n = write(fd, text, left);
        if (n <= 0) return;
        text += n;
        left -= (size_t)n;
    }
}

void WriteNumber(int fd, unsigned long long value, int base) {
    char buf[32];
    int i = sizeof(buf) - 1;
    buf[i] = 0;
    do {
        buf[--i] = "0123456789abcdef"[value % (unsigned)base];
        value /= (unsigned)base;
    } while (value && i > 2);
    if (base == 16) {
        buf[--i] = 'x';
        buf[--i] = '0';
    }
    Write(fd, buf + i);
}

const char* SignalName(int sig) {
    switch (sig) {
        case SIGSEGV: return "SIGSEGV (bad memory access)";
        case SIGBUS: return "SIGBUS (bad memory access)";
        case SIGILL: return "SIGILL (illegal instruction)";
        case SIGFPE: return "SIGFPE (arithmetic error)";
        case SIGABRT: return "SIGABRT (abort, usually a failed assert)";
        default: return "signal";
    }
}

void PassOn(int sig, siginfo_t* info, void* context) {
    const struct sigaction& previous = g_Previous[sig];
    if ((previous.sa_flags & SA_SIGINFO) && previous.sa_sigaction) {
        previous.sa_sigaction(sig, info, context);
        return;
    }
    if (!(previous.sa_flags & SA_SIGINFO) && previous.sa_handler != SIG_DFL && previous.sa_handler != SIG_IGN) {
        previous.sa_handler(sig);
        return;
    }
    signal(sig, SIG_DFL);
    raise(sig);
}

void Handler(int sig, siginfo_t* info, void* context) {
    if (!g_Entered) {
        g_Entered = 1;
        int fd = open(g_Path, O_WRONLY | O_CREAT | O_APPEND, 0644);
        if (fd >= 0) {
            Write(fd, "=== server crashed ===\ntime: ");
            WriteNumber(fd, (unsigned long long)time(nullptr), 10);
            Write(fd, " (unix)\nsignal: ");
            WriteNumber(fd, (unsigned long long)sig, 10);
            Write(fd, " ");
            Write(fd, SignalName(sig));
            Write(fd, "\nthread: ");
            WriteNumber(fd, (unsigned long long)syscall(SYS_gettid), 10);
            if (info) {
                Write(fd, "\nfault address: ");
                WriteNumber(fd, (unsigned long long)(uintptr_t)info->si_addr, 16);
            }
            void* frames[64];
            int count = backtrace(frames, 64);

            uintptr_t pc = 0;
#if defined(__x86_64__)
            if (context) pc = (uintptr_t)((ucontext_t*)context)->uc_mcontext.gregs[REG_RIP];
#endif
            // The first frames are this handler and the kernel's signal
            // trampoline; the real stack starts at the faulting instruction.
            int first = 0;
            for (int i = 0; pc && i < count; i++) {
                if ((uintptr_t)frames[i] == pc) {
                    first = i;
                    break;
                }
            }
            int modFrames = 0;
            for (int i = first; i < count; i++) modFrames += InMod((uintptr_t)frames[i]) ? 1 : 0;

            if (pc) {
                Write(fd, "\ninstruction: ");
                WriteNumber(fd, (unsigned long long)pc, 16);
            }
            Write(fd, "\ncrashed in: ");
            if (pc && InMod(pc)) {
                Write(fd, "the mod (librsdwapi.so)");
            } else if (modFrames) {
                Write(fd, "the game, called from the mod (");
                WriteNumber(fd, (unsigned long long)modFrames, 10);
                Write(fd, " mod frame(s) on the stack)");
            } else if (first) {
                Write(fd, "the game (no mod code on the stack)");
            } else {
                Write(fd, "unknown");
            }
            Write(fd, "\nbacktrace (frames in librsdwapi.so are the mod's own code):\n");
            backtrace_symbols_fd(frames + first, count - first, fd);
            Write(fd, "=== end ===\n\n");
            close(fd);
        }
    }
    PassOn(sig, info, context);
}

}

void Install(const std::string& path) {
    snprintf(g_Path, sizeof(g_Path), "%s", path.c_str());

    Dl_info self;
    if (dladdr((void*)&Install, &self) && self.dli_fbase) {
        uintptr_t base = (uintptr_t)self.dli_fbase;
        dl_iterate_phdr(&ModPhdrCallback, &base);
    }

    // backtrace() loads libgcc on first use, which allocates; do that now rather
    // than inside the handler.
    void* warm[2];
    backtrace(warm, 2);

    for (int sig : kSignals) {
        struct sigaction action;
        memset(&action, 0, sizeof(action));
        action.sa_sigaction = &Handler;
        action.sa_flags = SA_SIGINFO | SA_ONSTACK;
        sigemptyset(&action.sa_mask);
        sigaction(sig, &action, &g_Previous[sig]);
    }
}

long ResidentMegabytes() {
    FILE* statm = fopen("/proc/self/statm", "r");
    if (!statm) return -1;
    long pages = 0, resident = 0;
    int fields = fscanf(statm, "%ld %ld", &pages, &resident);
    fclose(statm);
    if (fields != 2) return -1;
    return resident * (sysconf(_SC_PAGESIZE) / 1024) / 1024;
}

}
