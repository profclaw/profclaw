#!/bin/bash
# GLINR Task Manager Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/GLINCKER/glinr-task-manager/main/install.sh | bash

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_banner() {
    echo -e "${BLUE}"
    echo "  ╔═══════════════════════════════════════╗"
    echo "  ║       GLINR Task Manager              ║"
    echo "  ║       AI-Native Task Orchestration    ║"
    echo "  ╚═══════════════════════════════════════╝"
    echo -e "${NC}"
}

info() { echo -e "${BLUE}→${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; exit 1; }

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Darwin*) OS="macos" ;;
        Linux*)  OS="linux" ;;
        MINGW*|MSYS*|CYGWIN*) OS="windows" ;;
        *) error "Unsupported operating system" ;;
    esac
}

# Detect best install method
# Priority: npm/pnpm (simplest) > Docker (self-contained) > from-source
detect_method() {
    info "Checking requirements..."

    # Check for npm/pnpm first (like OpenClaw pattern)
    if command -v pnpm &> /dev/null; then
        NODE_VERSION=$(node -v 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "${NODE_VERSION:-0}" -ge 22 ]; then
            success "pnpm + Node.js $NODE_VERSION found"
            INSTALL_METHOD="pnpm"
            return
        fi
    fi

    if command -v npm &> /dev/null; then
        NODE_VERSION=$(node -v 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "${NODE_VERSION:-0}" -ge 22 ]; then
            success "npm + Node.js $NODE_VERSION found"
            INSTALL_METHOD="npm"
            return
        fi
    fi

    # Fall back to Docker
    if command -v docker &> /dev/null && docker compose version &> /dev/null; then
        success "Docker + Docker Compose found"
        INSTALL_METHOD="docker"
        return
    elif command -v docker &> /dev/null; then
        success "Docker found (Compose plugin recommended)"
        INSTALL_METHOD="docker"
        return
    fi

    error "Node.js 22+ or Docker required.\n  Install Node.js: https://nodejs.org/\n  Install Docker:  https://docs.docker.com/get-docker/"
}

# npm/pnpm global install (like OpenClaw)
install_npm() {
    local pkg_manager="$1"
    info "Installing via $pkg_manager (global)..."

    if [ "$pkg_manager" = "pnpm" ]; then
        pnpm add -g glinr-task-manager@latest
    else
        npm install -g glinr-task-manager@latest
    fi

    success "Installed glinr-task-manager globally"
    success "CLI available as: glinr"
}

# Docker installation (clones repo for docker-compose.yml)
install_docker() {
    INSTALL_DIR="${GLINR_INSTALL_DIR:-$HOME/.glinr}"
    info "Installing to $INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"
    cd "$INSTALL_DIR"

    if [ -d "glinr-task-manager" ]; then
        info "Updating existing installation..."
        cd glinr-task-manager
        git pull --quiet
    else
        git clone --depth 1 --quiet https://github.com/GLINCKER/glinr-task-manager.git
        cd glinr-task-manager
    fi

    # Create .env from example if not exists
    if [ ! -f .env ]; then
        cp .env.example .env
        warn "Created .env from template — edit .env to add your API keys"
    fi

    # Create CLI wrapper for Docker commands
    GLINR_DIR="$INSTALL_DIR/glinr-task-manager"
    cat > "$INSTALL_DIR/glinr" << EOF
#!/bin/bash
cd "$GLINR_DIR"
case "\$1" in
    start)    docker compose up -d ;;
    start-ai) docker compose --profile ai up -d ;;
    stop)     docker compose down ;;
    logs)     docker compose logs -f glinr ;;
    restart)  docker compose restart ;;
    update)   git pull && docker compose pull && docker compose up -d ;;
    setup)    docker exec -it glinr-task-manager glinr setup ;;
    *)        echo "Usage: glinr {start|start-ai|stop|logs|restart|update|setup}" ;;
esac
EOF
    chmod +x "$INSTALL_DIR/glinr"

    # Try to symlink to PATH
    if [ -w "/usr/local/bin" ]; then
        ln -sf "$INSTALL_DIR/glinr" "/usr/local/bin/glinr" 2>/dev/null || true
        success "CLI installed to /usr/local/bin/glinr"
    else
        warn "Add to PATH: export PATH=\"\$PATH:$INSTALL_DIR\""
    fi

    success "Docker configuration ready"
}

# Print next steps
print_next_steps() {
    echo ""
    echo -e "${GREEN}Installation complete!${NC}"
    echo ""

    if [ "$INSTALL_METHOD" = "docker" ]; then
        echo "  Get started:"
        echo ""
        echo -e "  ${BLUE}1.${NC} Start GLINR + Redis:"
        echo "     glinr start"
        echo ""
        echo -e "  ${BLUE}2.${NC} Run setup wizard:"
        echo "     glinr setup"
        echo ""
        echo -e "  ${BLUE}3.${NC} Open dashboard:"
        echo "     http://localhost:3000"
        echo ""
        echo -e "  Want free local AI? ${BLUE}glinr start-ai${NC}"
    else
        echo "  Get started:"
        echo ""
        echo -e "  ${BLUE}1.${NC} Run setup wizard:"
        echo "     glinr setup"
        echo ""
        echo -e "  ${BLUE}2.${NC} Start the server:"
        echo "     glinr serve"
        echo ""
        echo -e "  ${BLUE}3.${NC} Open dashboard:"
        echo "     http://localhost:3000"
    fi

    echo ""
    echo "  Documentation:  https://glinr.dev/docs"
    echo "  Report issues:  https://github.com/GLINCKER/glinr-task-manager/issues"
    echo ""
}

# Main
main() {
    print_banner
    detect_os
    detect_method

    case "$INSTALL_METHOD" in
        pnpm)   install_npm "pnpm" ;;
        npm)    install_npm "npm" ;;
        docker) install_docker ;;
    esac

    print_next_steps
}

main "$@"
