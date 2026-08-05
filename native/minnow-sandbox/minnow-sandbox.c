/*
 * minnow-sandbox — Landlock + optional seccomp helper for agent one-shot shells.
 *
 * MIN-553 Phase 5. Node has no pre-exec hook, so we apply containment then execve
 * the real command (same argv-wrapper shape as macOS sandbox-exec).
 *
 * Policy is allowlist-based (Landlock cannot deny a child after allowing a parent):
 *   --write PATH  → full FS access under PATH (workspace / temp / caches)
 *   --read  PATH  → read + execute under PATH (system roots, home allowlist)
 *
 * Exit codes (before execve; JS maps these in landlock.js / unavailable.js):
 *   0   — --probe succeeded
 *   64  — usage / bad argv
 *   75  — Landlock ABI unavailable (ENOSYS / EOPNOTSUPP / ABI < 1)
 *   76  — Landlock apply failed after ABI negotiate
 *   127 — execve of inner command failed
 *
 * Seccomp is best-effort hardening only. We intentionally do NOT block clone,
 * socket, connect, openat, etc. — those break npm / git / node. Blocked set is
 * mount / module / reboot class only. Failure to install seccomp is non-fatal
 * (stderr warning); filesystem containment remains the v1 success criterion.
 *
 * Phase 6 (Windows WSL): invoke this same binary inside the WSL tree after
 * routing the agent one-shot through wsl.exe — see landlock.js exports.
 */

#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

/* Avoid depending on <linux/landlock.h> (may be absent on older distro headers). */

/* ---- Landlock ABI (syscall numbers are stable; headers may be missing) ---- */

#ifndef __NR_landlock_create_ruleset
#if defined(__x86_64__)
#define __NR_landlock_create_ruleset 444
#define __NR_landlock_add_rule 445
#define __NR_landlock_restrict_self 446
#elif defined(__aarch64__)
#define __NR_landlock_create_ruleset 444
#define __NR_landlock_add_rule 445
#define __NR_landlock_restrict_self 446
#else
#error "minnow-sandbox: unsupported architecture (need x86_64 or aarch64)"
#endif
#endif

#ifndef LANDLOCK_CREATE_RULESET_VERSION
#define LANDLOCK_CREATE_RULESET_VERSION (1U << 0)
#endif

#ifndef LANDLOCK_ACCESS_FS_EXECUTE
#define LANDLOCK_ACCESS_FS_EXECUTE (1ULL << 0)
#define LANDLOCK_ACCESS_FS_WRITE_FILE (1ULL << 1)
#define LANDLOCK_ACCESS_FS_READ_FILE (1ULL << 2)
#define LANDLOCK_ACCESS_FS_READ_DIR (1ULL << 3)
#define LANDLOCK_ACCESS_FS_REMOVE_DIR (1ULL << 4)
#define LANDLOCK_ACCESS_FS_REMOVE_FILE (1ULL << 5)
#define LANDLOCK_ACCESS_FS_MAKE_CHAR (1ULL << 6)
#define LANDLOCK_ACCESS_FS_MAKE_DIR (1ULL << 7)
#define LANDLOCK_ACCESS_FS_MAKE_REG (1ULL << 8)
#define LANDLOCK_ACCESS_FS_MAKE_SOCK (1ULL << 9)
#define LANDLOCK_ACCESS_FS_MAKE_FIFO (1ULL << 10)
#define LANDLOCK_ACCESS_FS_MAKE_BLOCK (1ULL << 11)
#define LANDLOCK_ACCESS_FS_MAKE_SYM (1ULL << 12)
#define LANDLOCK_ACCESS_FS_REFER (1ULL << 13)     /* ABI >= 2 */
#define LANDLOCK_ACCESS_FS_TRUNCATE (1ULL << 14)  /* ABI >= 3 */
#define LANDLOCK_ACCESS_FS_IOCTL_DEV (1ULL << 15) /* ABI >= 5 */
#endif

#ifndef LANDLOCK_RULE_PATH_BENEATH
#define LANDLOCK_RULE_PATH_BENEATH 1
#endif

struct landlock_ruleset_attr {
	uint64_t handled_access_fs;
	/* ABI >= 4 adds handled_access_net — we pass FS-only size below. */
};

struct landlock_path_beneath_attr {
	uint64_t allowed_access;
	int32_t parent_fd;
	/* Explicit padding matches kernel layout on 64-bit. */
	uint32_t _pad;
};

#define EXIT_USAGE 64
#define EXIT_LANDLOCK_UNSUPPORTED 75
#define EXIT_LANDLOCK_APPLY 76
#define EXIT_EXEC 127

#define MAX_PATHS 256

static const __u64 FS_READ_EXEC =
	LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE |
	LANDLOCK_ACCESS_FS_READ_DIR;

static const __u64 FS_WRITE =
	LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_REMOVE_DIR |
	LANDLOCK_ACCESS_FS_REMOVE_FILE | LANDLOCK_ACCESS_FS_MAKE_CHAR |
	LANDLOCK_ACCESS_FS_MAKE_DIR | LANDLOCK_ACCESS_FS_MAKE_REG |
	LANDLOCK_ACCESS_FS_MAKE_SOCK | LANDLOCK_ACCESS_FS_MAKE_FIFO |
	LANDLOCK_ACCESS_FS_MAKE_BLOCK | LANDLOCK_ACCESS_FS_MAKE_SYM;

static int ll_create_ruleset(struct landlock_ruleset_attr *attr, size_t size,
			     __u32 flags)
{
	return (int)syscall(__NR_landlock_create_ruleset, attr, size, flags);
}

static int ll_add_rule(int ruleset_fd, __u16 rule_type, const void *attr,
		       __u32 flags)
{
	return (int)syscall(__NR_landlock_add_rule, ruleset_fd, rule_type, attr,
			    flags);
}

static int ll_restrict_self(int ruleset_fd, __u32 flags)
{
	return (int)syscall(__NR_landlock_restrict_self, ruleset_fd, flags);
}

/**
 * Negotiate highest usable ABI by asking create_ruleset for the version, then
 * degrade handled_access_fs to what that ABI understands.
 * Returns ABI version (>=1) or -1 with errno set / EXIT_* intended by caller.
 */
static int negotiate_abi(void)
{
	int abi = ll_create_ruleset(NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
	if (abi < 0) {
		return -1;
	}
	return abi;
}

/** Handled FS access mask for a negotiated ABI (forward-compatible degrade). */
static __u64 handled_access_for_abi(int abi)
{
	__u64 access = FS_READ_EXEC | FS_WRITE;
	if (abi >= 2) {
		access |= LANDLOCK_ACCESS_FS_REFER;
	}
	if (abi >= 3) {
		access |= LANDLOCK_ACCESS_FS_TRUNCATE;
	}
	if (abi >= 5) {
		access |= LANDLOCK_ACCESS_FS_IOCTL_DEV;
	}
	return access;
}

static int add_path_beneath(int ruleset_fd, const char *path, __u64 access)
{
	int fd;
	struct landlock_path_beneath_attr attr;

	fd = open(path, O_PATH | O_CLOEXEC);
	if (fd < 0) {
		/* Missing optional paths (e.g. ~/.cargo on a fresh machine) — skip. */
		if (errno == ENOENT) {
			return 0;
		}
		fprintf(stderr, "minnow-sandbox: open(%s): %s\n", path,
			strerror(errno));
		return -1;
	}

	memset(&attr, 0, sizeof(attr));
	attr.allowed_access = access;
	attr.parent_fd = fd;
	if (ll_add_rule(ruleset_fd, LANDLOCK_RULE_PATH_BENEATH, &attr, 0) < 0) {
		fprintf(stderr, "minnow-sandbox: landlock_add_rule(%s): %s\n",
			path, strerror(errno));
		close(fd);
		return -1;
	}
	close(fd);
	return 0;
}

/**
 * Minimal seccomp: kill obviously host-hostile syscalls without touching the
 * spawn/network/IO surface agents need. Not a security boundary on its own —
 * Landlock FS rules are the containment; this is belt-and-suspenders.
 */
static int install_seccomp_minimal(void)
{
#ifdef __x86_64__
	/* BPF: if arch != AUDIT_ARCH_X86_64 → ALLOW (don't break weird callers);
	 * if nr in denylist → ERRNO(EPERM); else ALLOW.
	 */
	struct sock_filter filter[] = {
		/* load arch */
		BPF_STMT(BPF_LD | BPF_W | BPF_ABS,
			 (offsetof(struct seccomp_data, arch))),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_X86_64, 1, 0),
		BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
		/* load nr */
		BPF_STMT(BPF_LD | BPF_W | BPF_ABS,
			 (offsetof(struct seccomp_data, nr))),
		/* denylist — keep short; extend carefully after breakage reports */
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_mount, 6, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_umount2, 5, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_pivot_root, 4, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_reboot, 3, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_swapon, 2, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_swapoff, 1, 0),
		BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
		BPF_STMT(BPF_RET | BPF_K,
			 SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA)),
	};
	struct sock_fprog prog = {
		.len = (unsigned short)(sizeof(filter) / sizeof(filter[0])),
		.filter = filter,
	};

	if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) < 0) {
		return -1;
	}
	if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog) < 0) {
		return -1;
	}
	return 0;
#else
	/* aarch64: skip raw BPF denylist for now (different syscall table).
	 * Landlock alone still applies; document for Phase 5 follow-up.
	 */
	(void)0;
	return 0;
#endif
}

static void usage(const char *argv0)
{
	fprintf(stderr,
		"Usage: %s [--probe] [--no-seccomp] [--write PATH]... [--read PATH]... -- COMMAND [ARGS...]\n"
		"  --probe     Negotiate Landlock ABI; exit 0 if usable, 75 if not\n"
		"  --write P   Allow full FS access beneath P (repeatable)\n"
		"  --read P    Allow read+execute beneath P (repeatable)\n"
		"  --no-seccomp  Skip minimal seccomp harden\n",
		argv0);
}

int main(int argc, char **argv)
{
	int probe_only = 0;
	int use_seccomp = 1;
	const char *write_paths[MAX_PATHS];
	const char *read_paths[MAX_PATHS];
	int n_write = 0;
	int n_read = 0;
	int cmd_index = -1;
	int i;
	int abi;
	int ruleset_fd;
	struct landlock_ruleset_attr ruleset_attr;
	__u64 handled;
	__u64 write_access;
	__u64 read_access;

	for (i = 1; i < argc; i++) {
		if (strcmp(argv[i], "--") == 0) {
			cmd_index = i + 1;
			break;
		}
		if (strcmp(argv[i], "--probe") == 0) {
			probe_only = 1;
			continue;
		}
		if (strcmp(argv[i], "--no-seccomp") == 0) {
			use_seccomp = 0;
			continue;
		}
		if (strcmp(argv[i], "--write") == 0) {
			if (i + 1 >= argc || n_write >= MAX_PATHS) {
				usage(argv[0]);
				return EXIT_USAGE;
			}
			write_paths[n_write++] = argv[++i];
			continue;
		}
		if (strcmp(argv[i], "--read") == 0) {
			if (i + 1 >= argc || n_read >= MAX_PATHS) {
				usage(argv[0]);
				return EXIT_USAGE;
			}
			read_paths[n_read++] = argv[++i];
			continue;
		}
		if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
			usage(argv[0]);
			return 0;
		}
		fprintf(stderr, "minnow-sandbox: unknown option: %s\n", argv[i]);
		usage(argv[0]);
		return EXIT_USAGE;
	}

	if (!probe_only && (cmd_index < 0 || cmd_index >= argc)) {
		usage(argv[0]);
		return EXIT_USAGE;
	}

	abi = negotiate_abi();
	if (abi < 0) {
		fprintf(stderr,
			"minnow-sandbox: Landlock unavailable: %s\n",
			strerror(errno));
		return EXIT_LANDLOCK_UNSUPPORTED;
	}
	if (abi < 1) {
		fprintf(stderr, "minnow-sandbox: Landlock ABI %d too old\n", abi);
		return EXIT_LANDLOCK_UNSUPPORTED;
	}

	if (probe_only) {
		/* Honest signal for UI / resolveSandbox probe cache. */
		printf("landlock_abi=%d\n", abi);
		return 0;
	}

	handled = handled_access_for_abi(abi);
	memset(&ruleset_attr, 0, sizeof(ruleset_attr));
	ruleset_attr.handled_access_fs = handled;

	/* Pass FS-only attr size so kernels without net Landlock still accept us. */
	ruleset_fd = ll_create_ruleset(&ruleset_attr, sizeof(uint64_t), 0);
	if (ruleset_fd < 0) {
		fprintf(stderr, "minnow-sandbox: create_ruleset: %s\n",
			strerror(errno));
		return EXIT_LANDLOCK_APPLY;
	}

	/* Write paths get full handled access; read paths get the read/exec subset. */
	write_access = handled;
	read_access = handled & FS_READ_EXEC;
	/* REFER/TRUNCATE/IOCTL on read-only trees: keep execute+read only. */
	if (abi >= 2) {
		/* REFER is a linking right — omit from read-only allow. */
		read_access &= ~LANDLOCK_ACCESS_FS_REFER;
	}

	for (i = 0; i < n_write; i++) {
		if (add_path_beneath(ruleset_fd, write_paths[i], write_access) <
		    0) {
			close(ruleset_fd);
			return EXIT_LANDLOCK_APPLY;
		}
	}
	for (i = 0; i < n_read; i++) {
		if (add_path_beneath(ruleset_fd, read_paths[i], read_access) <
		    0) {
			close(ruleset_fd);
			return EXIT_LANDLOCK_APPLY;
		}
	}

	/* Without NO_NEW_PRIVS, restrict_self fails for unprivileged callers. */
	if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) < 0) {
		fprintf(stderr, "minnow-sandbox: PR_SET_NO_NEW_PRIVS: %s\n",
			strerror(errno));
		close(ruleset_fd);
		return EXIT_LANDLOCK_APPLY;
	}

	if (ll_restrict_self(ruleset_fd, 0) < 0) {
		fprintf(stderr, "minnow-sandbox: restrict_self: %s\n",
			strerror(errno));
		close(ruleset_fd);
		return EXIT_LANDLOCK_APPLY;
	}
	close(ruleset_fd);

	if (use_seccomp) {
		if (install_seccomp_minimal() < 0) {
			fprintf(stderr,
				"minnow-sandbox: warning: seccomp not applied (%s); continuing with Landlock only\n",
				strerror(errno));
		}
	}

	execvp(argv[cmd_index], &argv[cmd_index]);
	fprintf(stderr, "minnow-sandbox: execvp(%s): %s\n", argv[cmd_index],
		strerror(errno));
	return EXIT_EXEC;
}
