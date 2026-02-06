{
  description = "profClaw - AI Agent Task Orchestrator";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        nodejs = pkgs.nodejs_22;
        pnpm = pkgs.pnpm;
      in
      {
        packages.default = pkgs.buildNpmPackage rec {
          pname = "profclaw";
          version = "2.0.0";
          src = ./.;

          npmDepsHash = "sha256-PLACEHOLDER";
          nodejs = nodejs;

          nativeBuildInputs = [ pnpm nodejs ];

          buildPhase = ''
            pnpm install --frozen-lockfile
            pnpm build
          '';

          installPhase = ''
            mkdir -p $out/bin $out/lib/profclaw
            cp -r dist/* $out/lib/profclaw/
            cp -r node_modules $out/lib/profclaw/
            cp package.json $out/lib/profclaw/

            cat > $out/bin/profclaw <<EOF
            #!/usr/bin/env bash
            exec ${nodejs}/bin/node $out/lib/profclaw/cli/index.js "\$@"
            EOF
            chmod +x $out/bin/profclaw
          '';

          meta = with pkgs.lib; {
            description = "AI Agent Task Orchestrator";
            homepage = "https://github.com/profclaw/profclaw";
            license = licenses.agpl3Only;
            platforms = platforms.all;
          };
        };

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs
            pnpm
            docker
            docker-compose
          ];

          shellHook = ''
            echo "profClaw dev environment ready"
            echo "Node: $(node --version)"
            echo "pnpm: $(pnpm --version)"
          '';
        };
      }
    );
}
