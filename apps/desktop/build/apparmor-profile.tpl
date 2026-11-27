abi <abi/4.0>,
include <tunables/global>

# Ubuntu 24 and later only let programs with a profile like this make the user namespaces Chromium's
# sandbox needs. scterra is a launcher script and scterra-bin the browser itself (see after-pack.cjs).
profile "${executable}" "/opt/${sanitizedProductName}/${executable}{,-bin}" flags=(unconfined) {
  userns,

  # Site-specific additions and overrides. See local/README for details.
  include if exists <local/${executable}>
}
