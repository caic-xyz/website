#!/bin/sh
# Install caic and md from https://caic.xyz/install.sh | bash
set -eu

INSTALL_DIR="${HOME}/.local/bin"

die() { echo "error: $*" >&2; exit 1; }

detect_os() {
    case "$(uname -s)" in
        Linux)  echo linux ;;
        Darwin) echo darwin ;;
        *)      die "unsupported OS: $(uname -s)" ;;
    esac
}

detect_arch() {
    case "$(uname -m)" in
        x86_64|amd64)   echo amd64 ;;
        aarch64|arm64)  echo arm64 ;;
        *)               die "unsupported arch: $(uname -m)" ;;
    esac
}

latest_version() {
    repo="$1"
    url="https://api.github.com/repos/${repo}/releases/latest"
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$url"
    elif command -v wget >/dev/null 2>&1; then
        wget -qO- "$url"
    else
        die "curl or wget is required"
    fi | grep '"tag_name"' | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/'
}

download() {
    url="$1"
    dest="$2"
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL -o "$dest" "$url"
    else
        wget -qO "$dest" "$url"
    fi
}

install_tool() {
    binary="$1"
    repo="$2"
    os="$3"
    arch="$4"

    printf 'Installing %s from %s...\n' "$binary" "$repo"
    tag="$(latest_version "$repo")"
    [ -n "$tag" ] || die "could not determine latest version of $repo"
    version="${tag#v}"

    archive="${binary}_${version}_${os}_${arch}.tar.gz"
    url="https://github.com/${repo}/releases/download/${tag}/${archive}"

    tmpdir="$(mktemp -d)"
    trap 'rm -rf "$tmpdir"' EXIT

    printf '  Downloading %s\n' "$url"
    download "$url" "${tmpdir}/${archive}"

    # Verify checksum if checksums.txt is available
    checksum_url="https://github.com/${repo}/releases/download/${tag}/checksums.txt"
    if download "$checksum_url" "${tmpdir}/checksums.txt" 2>/dev/null; then
        ( cd "$tmpdir" && grep " ${archive}$" checksums.txt | sha256sum -c - ) \
            || die "checksum verification failed for $archive"
    fi

    tar -xzf "${tmpdir}/${archive}" -C "$tmpdir" "$binary"
    chmod +x "${tmpdir}/${binary}"
    mv "${tmpdir}/${binary}" "${INSTALL_DIR}/${binary}"

    trap - EXIT
    rm -rf "$tmpdir"
    printf '  Installed %s %s to %s\n' "$binary" "$tag" "${INSTALL_DIR}/${binary}"
}

main() {
    os="$(detect_os)"
    arch="$(detect_arch)"

    mkdir -p "$INSTALL_DIR"

    install_tool caic caic-xyz/caic "$os" "$arch"
    install_tool md   caic-xyz/md   "$os" "$arch"

    # Remind user to add INSTALL_DIR to PATH if needed
    case ":${PATH}:" in
        *":${INSTALL_DIR}:"*) ;;
        *)
            printf '\nNote: add %s to your PATH:\n' "$INSTALL_DIR"
            printf '  echo '\''export PATH="%s:$PATH"'\'' >> ~/.bashrc\n' "$INSTALL_DIR"
            printf '  (or ~/.zshrc, ~/.profile, etc.)\n'
            ;;
    esac

    printf '\nDone. Run `caic --help` and `md --help` to get started.\n'
}

main
