{
  description = "openplate development shell: node 24 and pnpm_11 for all three apps";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
  };

  outputs = { self, nixpkgs, ... }: let
    # The systems this shell is expected to work on, so a contributor on an
    # Apple silicon Mac gets the same toolchain as one on Linux.
    # No Intel Mac: nixpkgs 26.11 dropped x86_64-darwin.
    systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
    forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f (import nixpkgs { inherit system; }));
  in {
    devShells = forAllSystems (pkgs: {
      # pkgs.pnpm_11 is a newer 11.x than packageManager. Inside an app
      # directory it switches to the packageManager version (one download),
      # so only the major has to match: scripts/check-env-drift.sh checks it.
      # The Playwright browsers path is not wired to nixpkgs: its
      # playwright-driver differs from the @playwright/test pin, so the browser
      # tier keeps Playwright's own download in ~/.cache/ms-playwright. That
      # Chromium is a generic Linux binary. On NixOS it starts only through
      # nix-ld, and nix-ld's default library set lacks glib, nss and the rest.
      # NIX_LD_LIBRARY_PATH below adds them.
      default = pkgs.mkShell {
        packages = [
          pkgs.nodejs_24
          pkgs.pnpm_11
          pkgs.git
          pkgs.gnumake
          pkgs.bash
          # All three pre-push hooks run scripts/quadlet.sh check, which needs
          # podlet on PATH. The committed units come from podlet 0.3.2.
          pkgs.podlet
        ] ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [
          # The fonts the browser tier renders with, see OPENPLATE_E2E_FONT_DIRS.
          pkgs.liberation_ttf
        ];

        # Libraries for Playwright's downloaded Chromium on NixOS with nix-ld.
        # NIX_LD_LIBRARY_PATH, never LD_LIBRARY_PATH: nix-ld reads it only for
        # non-nix binaries it launches, so the nix node and pnpm are untouched.
        # NIX_LD points at the dynamic linker of this flake's glibc. The libraries
        # below are built for that glibc, and the system's nix-ld may ship an
        # older one (the host had 2.42, the lock has 2.43), which fails with
        # "GLIBC_2.43 not found". NIX_LD overrides the system value in this shell.
        # On non-NixOS Linux (Fedora Silverblue) there is no nix-ld and the
        # variable does nothing. On macOS it is not set at all.
        NIX_LD = pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isLinux pkgs.stdenv.cc.bintools.dynamicLinker;
        NIX_LD_LIBRARY_PATH = pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isLinux (pkgs.lib.makeLibraryPath [
          pkgs.glib
          pkgs.nspr
          pkgs.nss
          pkgs.atk
          pkgs.at-spi2-atk
          pkgs.at-spi2-core
          pkgs.dbus
          pkgs.cups
          pkgs.expat
          pkgs.libxcb
          pkgs.libxkbcommon
          pkgs.alsa-lib
          pkgs.libgbm
          pkgs.libdrm
          pkgs.libx11
          pkgs.libxext
          pkgs.libxcomposite
          pkgs.libxdamage
          pkgs.libxfixes
          pkgs.libxrandr
          pkgs.cairo
          pkgs.pango
          pkgs.systemd
          pkgs.stdenv.cc.cc.lib
        ]);

        # Fonts for that Chromium. On NixOS none of the directories in
        # apps/app/tests/e2e/fonts.conf hold fonts, so the browser has none and
        # every text box is 0 px tall. OPENPLATE_E2E_FONT_DIRS is a colon
        # separated list of directories; tests/e2e/font-cache.ts adds one <dir>
        # per entry to the fontconfig it hands Chromium. Linux only: the
        # variable is empty elsewhere, and an empty list adds nothing.
        OPENPLATE_E2E_FONT_DIRS = pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isLinux "${pkgs.liberation_ttf}/share/fonts";

        # stderr only, so `nix develop -c <cmd>` prints just the command output.
        # The pnpm_11 version comes from nix, so the hook never runs a
        # package manager (inside an app that would trigger a download).
        shellHook = ''
          echo "openplate shell: node $(${pkgs.nodejs_24}/bin/node --version), pnpm_11 ${pkgs.pnpm_11.version}" >&2
        '';
      };
    });
  };
}
