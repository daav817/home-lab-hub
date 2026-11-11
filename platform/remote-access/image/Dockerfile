# MeshCentral (remote desktop for the home PCs), with the login modules baked in.
#
# With an OIDC login configured, MeshCentral runs "npm install" for passport, connect-flash and
# openid-client at every start (exact versions from meshcentral.js, line ~4446). Installing them
# here instead means the server never downloads code at runtime, and the result is scanned and
# pinned like any other image. Bump the base digest and these versions together.
#
# Also, so the Trivy scan (HIGH/CRITICAL with a fix) passes, as of 1.3.1:
# - Alpine packages updated (curl, krb5),
# - compression, node-forge and image-size raised to their patched releases,
# - the MariaDB/MySQL drivers removed (this server uses its built-in database),
# - npm itself removed after the install: nothing may be installed at runtime anyway.
FROM ghcr.io/ylianst/meshcentral:1.3.1@sha256:266b01942545829f11d53e6cecd5c2e48033d9edb48bbd3a9a569482ff1d050d

RUN apk upgrade --no-cache

WORKDIR /opt/meshcentral/meshcentral
# MeshCentral checks each module's exact version at start and wants to npm-install any
# mismatch, so its own list is pointed at the patched releases (the build stops if the text
# it edits ever changes). image-size is needed for indexing session recordings.
RUN sed -i -e "s/'compression@1.8.1'/'compression@1.8.2'/" -e "s/'node-forge@1.4.0'/'node-forge@1.4.1'/" \
      -e "s/'image-size@2.0.2'/'image-size@2.0.3'/g" meshcentral.js \
 && grep -q "'compression@1.8.2'" meshcentral.js && grep -q "'node-forge@1.4.1'" meshcentral.js \
 && grep -q "'image-size@2.0.3'" meshcentral.js && ! grep -q "'image-size@2.0.2'" meshcentral.js \
 && npm install --no-audit --no-fund --omit=optional --no-save \
      passport@0.7.0 connect-flash@0.1.1 openid-client@5.7.1 image-size@2.0.3 \
      compression@1.8.2 node-forge@1.4.1 \
 && rm -rf node_modules/mariadb node_modules/mysql2 \
 && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /root/.npm \
 && chown -R 1000:1000 /opt/meshcentral

# The base image runs as root; the node user (1000) is enough behind a TLS-offloading proxy.
USER 1000:1000
WORKDIR /opt/meshcentral
