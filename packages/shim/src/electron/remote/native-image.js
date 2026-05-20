function createImage(buffer, mimeType) {
  return {
    _buffer: buffer,
    _mimeType: mimeType || "image/png",

    isEmpty() {
      return !buffer || buffer.length === 0;
    },

    getSize() {
      return { width: 0, height: 0 };
    },

    toPNG() {
      return buffer || new Uint8Array(0);
    },

    toJPEG(quality) {
      return buffer || new Uint8Array(0);
    },

    toDataURL() {
      if (!buffer || buffer.length === 0) {
        return "";
      }

      const bytes =
        buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      let binary = "";

      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }

      return `data:${this._mimeType};base64,${btoa(binary)}`;
    },

    toBitmap() {
      return buffer || new Uint8Array(0);
    },

    getBitmap() {
      return buffer || new Uint8Array(0);
    },
  };
}

export const nativeImageShim = {
  createFromBuffer(buffer, options) {
    return createImage(buffer, options?.mimeType);
  },

  createFromPath(filePath) {
    return createImage(new Uint8Array(0));
  },

  createEmpty() {
    return createImage(new Uint8Array(0));
  },

  createFromDataURL(dataURL) {
    if (!dataURL || !dataURL.startsWith("data:")) {
      return createImage(new Uint8Array(0));
    }

    const parts = dataURL.split(",");
    const mimeMatch = parts[0].match(/data:([^;]+)/);
    const mimeType = mimeMatch ? mimeMatch[1] : "image/png";

    try {
      const binary = atob(parts[1]);
      const bytes = new Uint8Array(binary.length);

      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      return createImage(bytes, mimeType);
    } catch {
      return createImage(new Uint8Array(0));
    }
  },
};
