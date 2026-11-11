# MeshCentral (remote desktop for the home PCs), with the login modules baked in.
#
# With an OIDC login configured, MeshCentral runs "npm install" for passport, connect-flash and
# openid-client at every start (exact versions from meshcentral.js, line ~4446). Installing them
# here instead means the server never downloads code at runtime, and the result is scanned and
# pinned like any other image. Bump the base digest and these versions together.
FROM ghcr.io/ylianst/meshcentral:1.3.1@sha256:266b01942545829f11d53e6cecd5c2e48033d9edb48bbd3a9a569482ff1d050d

WORKDIR /opt/meshcentral/meshcentral
RUN npm install --no-audit --no-fund --omit=optional --no-save \
      passport@0.7.0 connect-flash@0.1.1 openid-client@5.7.1 \
 && npm cache clean --force \
 && chown -R 1000:1000 /opt/meshcentral

# The base image runs as root; the node user (1000) is enough behind a TLS-offloading proxy.
USER 1000:1000
WORKDIR /opt/meshcentral
