{
  description = "openplate development shell: node 24 and pnpm_11 for all four apps";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
  };

  outputs = { self, nixpkgs, ... }: let
    # The four systems this shell is expected to work on, so a contributor
    # on a Mac gets the same toolchain as one on Linux.
    systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
    forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f (import nixpkgs { inherit system; }));
  in {
    devShells = forAllSystems (pkgs: {
      # pkgs.pnpm_11 is a newer 11.x than packageManager. Inside an app
      # directory it switches to the packageManager version (one download),
      # so only the major has to match: scripts/check-env-drift.sh checks it.
      # The Playwright browsers path is not wired to nixpkgs: its
      # playwright-driver differs from the @playwright/test pin, so the
      # browser tier stays in the toolbox until the two versions match.
      default = pkgs.mkShell {
        packages = [
          pkgs.nodejs_24
          pkgs.pnpm_11
          pkgs.git
          pkgs.gnumake
          pkgs.bash
        ];

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
