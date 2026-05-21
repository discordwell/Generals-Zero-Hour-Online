// Generals headless save-game oracle — v1: chunk walker.
//
// Reads a .sav file produced by the original C&C Generals C++ engine
// and emits a JSON inventory of its CHUNK_<name> blocks (offset, size,
// name).  This is the canonical save-file framing format documented in
// GeneralsMD/Code/GameEngine/Source/Common/System/XferLoad.cpp.
//
// Future versions will progressively parse the chunks' contents
// (frame counter, object TOC, per-object xfer streams, etc.) until the
// oracle can dump the full simulation state as JSON.
//
// Build:
//   cmake -S tools/oracle -B tools/oracle/build -G "MinGW Makefiles"
//   cmake --build tools/oracle/build
//
// Usage:
//   oracle <path/to/file.sav>
//
// The output goes to stdout; diagnostics to stderr.
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace {

constexpr const char* kEofToken = "SG_EOF";

// Mirrors the Generals save format documented in
// XferLoad::xferAsciiString (XferLoad.cpp:201):
//   uint8  length
//   char   bytes[length]
struct Reader {
  const std::uint8_t* data;
  std::size_t length;
  std::size_t offset = 0;

  [[nodiscard]] bool require(std::size_t n) const {
    return offset + n <= length;
  }

  std::uint8_t readUInt8() {
    if (!require(1)) throw std::runtime_error("oracle: unexpected EOF reading u8");
    return data[offset++];
  }

  std::int32_t readInt32LE() {
    if (!require(4)) throw std::runtime_error("oracle: unexpected EOF reading i32");
    std::int32_t value =
        static_cast<std::int32_t>(data[offset])
        | (static_cast<std::int32_t>(data[offset + 1]) << 8)
        | (static_cast<std::int32_t>(data[offset + 2]) << 16)
        | (static_cast<std::int32_t>(data[offset + 3]) << 24);
    offset += 4;
    return value;
  }

  std::string readAsciiString() {
    const std::uint8_t len = readUInt8();
    if (!require(len)) throw std::runtime_error("oracle: unexpected EOF reading string body");
    std::string s(reinterpret_cast<const char*>(data + offset), len);
    offset += len;
    return s;
  }

  void skip(std::size_t n) {
    if (!require(n)) throw std::runtime_error("oracle: unexpected EOF in skip");
    offset += n;
  }
};

struct ChunkRecord {
  std::string blockName;
  std::size_t blockStartOffset;   // start of the AsciiString name
  std::size_t blockDataOffset;    // start of the payload bytes
  std::int32_t blockSize;
};

[[nodiscard]] std::vector<std::uint8_t> readFile(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) {
    throw std::runtime_error("oracle: failed to open file: " + path);
  }
  in.seekg(0, std::ios::end);
  const std::streamsize size = in.tellg();
  if (size <= 0) {
    throw std::runtime_error("oracle: empty or unseekable file: " + path);
  }
  in.seekg(0, std::ios::beg);
  std::vector<std::uint8_t> bytes(static_cast<std::size_t>(size));
  if (!in.read(reinterpret_cast<char*>(bytes.data()), size)) {
    throw std::runtime_error("oracle: read failed: " + path);
  }
  return bytes;
}

[[nodiscard]] std::vector<ChunkRecord> walkChunks(const std::vector<std::uint8_t>& bytes) {
  Reader r{bytes.data(), bytes.size()};
  std::vector<ChunkRecord> chunks;
  while (r.require(1)) {
    const std::string blockName = r.readAsciiString();
    if (blockName == kEofToken) {
      break;
    }
    // Source parity: TS @generals/engine listSaveGameChunks records
    // blockStartOffset as the position AFTER the token, i.e. the start of
    // the int32 size field.  Mirror that so per-fixture diffs are
    // apples-to-apples.
    const std::size_t blockStart = r.offset;
    const std::int32_t blockSize = r.readInt32LE();
    const std::size_t blockData = r.offset;
    chunks.push_back({blockName, blockStart, blockData, blockSize});
    if (blockSize < 0) {
      throw std::runtime_error("oracle: negative block size for " + blockName);
    }
    r.skip(static_cast<std::size_t>(blockSize));
  }
  return chunks;
}

// Lightweight JSON-stringify for ASCII content; the chunk names only
// contain printable ASCII so we don't need full Unicode escaping.
[[nodiscard]] std::string jsonString(const std::string& s) {
  std::string out;
  out.reserve(s.size() + 2);
  out += '"';
  for (char c : s) {
    switch (c) {
      case '"':  out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\b': out += "\\b";  break;
      case '\f': out += "\\f";  break;
      case '\n': out += "\\n";  break;
      case '\r': out += "\\r";  break;
      case '\t': out += "\\t";  break;
      default:
        if (static_cast<unsigned char>(c) < 0x20) {
          char buf[8];
          std::snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned>(c));
          out += buf;
        } else {
          out += c;
        }
    }
  }
  out += '"';
  return out;
}

void emitJson(const std::string& path, const std::vector<ChunkRecord>& chunks, std::size_t fileSize) {
  std::cout << "{\n";
  std::cout << "  \"fixture\": " << jsonString(path) << ",\n";
  std::cout << "  \"fileSize\": " << fileSize << ",\n";
  std::cout << "  \"chunkCount\": " << chunks.size() << ",\n";
  std::cout << "  \"chunks\": [\n";
  for (std::size_t i = 0; i < chunks.size(); i++) {
    const auto& c = chunks[i];
    std::cout
      << "    { \"name\": " << jsonString(c.blockName)
      << ", \"blockStartOffset\": " << c.blockStartOffset
      << ", \"blockDataOffset\": " << c.blockDataOffset
      << ", \"blockSize\": " << c.blockSize
      << " }";
    if (i + 1 < chunks.size()) std::cout << ',';
    std::cout << '\n';
  }
  std::cout << "  ]\n";
  std::cout << "}\n";
}

} // namespace

int main(int argc, char* argv[]) {
  if (argc < 2) {
    std::fprintf(stderr,
                 "usage: %s <path/to/save.sav>\n"
                 "v1 oracle: walks the .sav's CHUNK_<name> block list and\n"
                 "emits a JSON inventory to stdout.\n",
                 argv[0] ? argv[0] : "oracle");
    return 64; // EX_USAGE
  }

  try {
    const std::string path = argv[1];
    const std::vector<std::uint8_t> bytes = readFile(path);
    const std::vector<ChunkRecord> chunks = walkChunks(bytes);
    emitJson(path, chunks, bytes.size());
    return 0;
  } catch (const std::exception& e) {
    std::fprintf(stderr, "oracle: %s\n", e.what());
    return 1;
  }
}
