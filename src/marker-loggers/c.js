"use strict";

const {
  createMarkerTransformer,
  escapeDoubleQuotedString,
} = require("./common");

const transformCMarkers = createMarkerTransformer(
  (marker) => `fprintf(stderr, "%s\\n", "${escapeDoubleQuotedString(marker.message)}");`
);

module.exports = {
  transformCMarkers,
};
