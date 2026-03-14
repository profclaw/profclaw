class Profclaw < Formula
  desc "AI Agent Task Orchestrator - local-first, multi-provider"
  homepage "https://github.com/profclaw/profclaw"
  url "https://registry.npmjs.org/profclaw/-/profclaw-2.0.0.tgz"
  sha256 "PLACEHOLDER"
  license "AGPL-3.0-only"

  depends_on "node@22"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  def post_install
    (var/"profclaw").mkpath
  end

  service do
    run [opt_bin/"profclaw", "serve"]
    keep_alive true
    working_dir var/"profclaw"
    log_path var/"log/profclaw.log"
    error_log_path var/"log/profclaw-error.log"
    environment_variables PROFCLAW_MODE: "mini", PORT: "3000"
  end

  test do
    assert_match "profClaw", shell_output("#{bin}/profclaw --version")
  end
end
