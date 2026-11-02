function isHighSurrogate(unit) {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function isLowSurrogate(unit) {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

function utf8ByteLength(text) {
  let bytes = 0;

  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);

    if (unit < 0x80) {
      bytes += 1;
    } else if (unit < 0x800) {
      bytes += 2;
    } else if (
      isHighSurrogate(unit) &&
      isLowSurrogate(text.charCodeAt(i + 1))
    ) {
      bytes += 4;
      i++;
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

export { utf8ByteLength };
