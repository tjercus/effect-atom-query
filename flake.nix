{
  description = "effect-atom-query: development shell and runnable examples";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      # Node.js >= 22.18 (package.json `engines`). pnpm from nixpkgs bootstraps the
      # exact version pinned in package.json `devEngines`, which it downloads itself.
      toolsFor = pkgs: [
        pkgs.nodejs_22
        pkgs.pnpm_12
      ];

      # Runs a `vp run` task from the repository the command is started in,
      # installing dependencies first when they are missing or out of date.
      runScript =
        pkgs: name: script:
        pkgs.writeShellApplication {
          inherit name;
          runtimeInputs = toolsFor pkgs ++ [ pkgs.git ];
          text = ''
            root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
            cd "$root"
            if [ ! -f package.json ] || ! grep -q '"name": "effect-atom-query"' package.json; then
              echo "Run this from a clone of effect-atom-query." >&2
              exit 1
            fi
            if [ ! -d node_modules ] || [ pnpm-lock.yaml -nt node_modules/.modules.yaml ]; then
              pnpm install --frozen-lockfile
            fi
            exec ./node_modules/.bin/vp run ${script} "$@"
          '';
        };
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = toolsFor pkgs;
          shellHook = ''
            # The project-local `vp` (from the vite-plus dev dependency) after `pnpm install`.
            export PATH="$PWD/node_modules/.bin:$PATH"
            if [ ! -d node_modules ]; then
              echo "Run 'pnpm install' once, then 'vp run dev:flights' or 'vp run dev'."
            fi
          '';
        };
      });

      apps = forAllSystems (
        pkgs:
        let
          app = name: script: {
            type = "app";
            program = "${runScript pkgs name script}/bin/${name}";
            meta.description = "Run `vp run ${script}` in this repository";
          };
        in
        {
          default = app "flight-dashboard" "dev:flights";
          flights = app "flight-dashboard" "dev:flights";
          playground = app "playground" "dev";
          docs = app "docs" "docs#dev";
        }
      );

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
