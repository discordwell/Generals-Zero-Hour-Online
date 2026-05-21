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

  std::uint32_t readUInt32LE() {
    return static_cast<std::uint32_t>(readInt32LE());
  }

  std::uint16_t readUInt16LE() {
    if (!require(2)) throw std::runtime_error("oracle: unexpected EOF reading u16");
    std::uint16_t value =
        static_cast<std::uint16_t>(data[offset])
        | (static_cast<std::uint16_t>(data[offset + 1]) << 8);
    offset += 2;
    return value;
  }

  float readFloat32LE() {
    static_assert(sizeof(float) == 4, "expecting IEEE 754 single-precision");
    if (!require(4)) throw std::runtime_error("oracle: unexpected EOF reading f32");
    float value;
    std::memcpy(&value, data + offset, 4);
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
  std::size_t blockStartOffset;   // start of the int32 size (per TS convention)
  std::size_t blockDataOffset;    // start of the payload bytes
  std::int32_t blockSize;
};

struct TocEntry {
  std::string templateName;
  std::uint16_t id;
};

// Source: GameLogic::xfer (GameLogic.cpp:6098) + xferObjectTOC
// (GameLogic.cpp:5933).  CHUNK_GameLogic payload format:
//   u8     version (currentVersion = 10)
//   u32    m_frame
//   u8     TOC version (1)
//   u32    tocCount
//   tocCount × { AsciiString templateName; u16 id }
//   u32    objectCount
//   objectCount × { u16 tocID; i32 blockSize; <blockSize> bytes of Object::xfer }
// Per-object header decoded from the first ~bytes of Object::xfer
// (Object.cpp:4032).  Identity-only fields — module list, status bits,
// and the rest of the payload are deferred to a later oracle version.
struct ObjectIdentity {
  bool parsed = false;
  std::uint8_t version = 0;
  std::uint32_t objectId = 0;
  // For v>=7: row-major 4x3 matrix3D (12 floats).
  // For v<7: position (x,y,z) + orientation (4 floats total).
  std::uint32_t teamId = 0;
  std::uint32_t producerId = 0;
  std::uint32_t builderId = 0;
  std::uint32_t drawableId = 0;
  std::string internalName;
};

struct ObjectRecord {
  std::uint16_t tocId;
  std::int32_t  blockSize;
  std::size_t   blockDataOffset; // offset into CHUNK_GameLogic payload
  std::string   templateName;    // resolved from TOC
  ObjectIdentity identity;
};

struct GameLogicHeader {
  std::uint8_t  version;
  std::uint32_t frame;
  std::uint8_t  tocVersion;
  std::uint32_t tocCount;
  std::vector<TocEntry> toc;
  std::uint32_t objectCount;
  std::vector<ObjectRecord> objects;
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

[[nodiscard]] GameLogicHeader parseGameLogicHeader(
    const std::vector<std::uint8_t>& bytes,
    std::size_t chunkOffset,
    std::int32_t chunkSize) {
  // xferVersion is a single byte (XferVersion = UnsignedByte; Xfer.h:53).
  if (chunkOffset + static_cast<std::size_t>(chunkSize) > bytes.size()) {
    throw std::runtime_error("oracle: CHUNK_GameLogic extends past file end");
  }
  Reader r{bytes.data() + chunkOffset, static_cast<std::size_t>(chunkSize)};
  GameLogicHeader h{};
  h.version = r.readUInt8();
  h.frame = r.readUInt32LE();
  h.tocVersion = r.readUInt8();
  h.tocCount = r.readUInt32LE();
  h.toc.reserve(h.tocCount);
  for (std::uint32_t i = 0; i < h.tocCount; i++) {
    TocEntry e{};
    e.templateName = r.readAsciiString();
    e.id = r.readUInt16LE();
    h.toc.push_back(std::move(e));
  }
  h.objectCount = r.readUInt32LE();

  // Build a TOC-id → templateName lookup for resolution.
  std::vector<std::string> tocNameById(0x10000);
  for (const auto& e : h.toc) {
    if (e.id < tocNameById.size()) tocNameById[e.id] = e.templateName;
  }

  // v3: walk every per-object header (tocID + blockSize).
  // v4: decode the IDENTITY portion of the Object::xfer payload —
  //     version, objectId, transformMatrix or position+orientation,
  //     teamId, producerId, builderId, drawableId, internalName.
  //     Status bits + module list deferred to a later version.
  h.objects.reserve(h.objectCount);
  for (std::uint32_t i = 0; i < h.objectCount; i++) {
    ObjectRecord rec{};
    rec.tocId = r.readUInt16LE();
    rec.blockSize = r.readInt32LE();
    rec.blockDataOffset = chunkOffset + r.offset;
    if (rec.tocId < tocNameById.size()) {
      rec.templateName = tocNameById[rec.tocId];
    }
    if (rec.blockSize < 0) {
      throw std::runtime_error("oracle: negative object blockSize");
    }

    // Parse identity from the start of the payload.  If anything throws
    // we leave identity.parsed=false so the JSON emit and differential
    // skip the entity — corrupted payloads shouldn't kill the whole run.
    Reader objectReader{r.data + r.offset, static_cast<std::size_t>(rec.blockSize)};
    try {
      ObjectIdentity id;
      id.version = objectReader.readUInt8();
      // ObjectID = unsigned int = 4 bytes (Xfer::xferObjectID).
      id.objectId = objectReader.readUInt32LE();
      // version >= 7: xferMatrix3D writes its OWN u8 version byte + 12
      //               floats = 49 bytes (Xfer.cpp:842).
      // version <  7: Coord3D (3 floats) + Real (1 float) = 16 bytes.
      const std::size_t mtxBytes = (id.version >= 7) ? 49 : 16;
      objectReader.skip(mtxBytes);
      // TeamID xfered as raw bytes via xferUser(&teamID, sizeof(TeamID)).
      // TeamID is unsigned int = 4 bytes.
      id.teamId = objectReader.readUInt32LE();
      // producerID, builderID — both ObjectID = u32.
      id.producerId = objectReader.readUInt32LE();
      id.builderId = objectReader.readUInt32LE();
      // drawableID — u32.
      id.drawableId = objectReader.readUInt32LE();
      // internalName — AsciiString (u8 length prefix + chars).
      id.internalName = objectReader.readAsciiString();
      id.parsed = true;
      rec.identity = std::move(id);
    } catch (const std::exception&) {
      // Leave rec.identity.parsed = false; differential will treat as
      // "not yet supported" and skip per-field comparison for this entity.
    }

    r.skip(static_cast<std::size_t>(rec.blockSize));
    h.objects.push_back(std::move(rec));
  }
  return h;
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

void emitJson(
    const std::string& path,
    const std::vector<ChunkRecord>& chunks,
    std::size_t fileSize,
    const GameLogicHeader* glHeader) {
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
  std::cout << "  ]";
  if (glHeader != nullptr) {
    std::cout << ",\n  \"gameLogic\": {\n";
    std::cout << "    \"version\": " << static_cast<unsigned>(glHeader->version) << ",\n";
    std::cout << "    \"frameCounter\": " << glHeader->frame << ",\n";
    std::cout << "    \"tocVersion\": " << static_cast<unsigned>(glHeader->tocVersion) << ",\n";
    std::cout << "    \"tocCount\": " << glHeader->tocCount << ",\n";
    std::cout << "    \"objectCount\": " << glHeader->objectCount << ",\n";
    std::cout << "    \"toc\": [\n";
    for (std::size_t i = 0; i < glHeader->toc.size(); i++) {
      const auto& e = glHeader->toc[i];
      std::cout << "      { \"templateName\": " << jsonString(e.templateName)
                << ", \"id\": " << e.id << " }";
      if (i + 1 < glHeader->toc.size()) std::cout << ',';
      std::cout << '\n';
    }
    std::cout << "    ],\n";
    std::cout << "    \"objects\": [\n";
    for (std::size_t i = 0; i < glHeader->objects.size(); i++) {
      const auto& o = glHeader->objects[i];
      std::cout << "      { \"tocId\": " << o.tocId
                << ", \"templateName\": " << jsonString(o.templateName)
                << ", \"blockDataOffset\": " << o.blockDataOffset
                << ", \"blockSize\": " << o.blockSize;
      if (o.identity.parsed) {
        std::cout << ", \"identity\": { "
                  << "\"version\": " << static_cast<unsigned>(o.identity.version)
                  << ", \"objectId\": " << o.identity.objectId
                  << ", \"teamId\": " << o.identity.teamId
                  << ", \"producerId\": " << o.identity.producerId
                  << ", \"builderId\": " << o.identity.builderId
                  << ", \"drawableId\": " << o.identity.drawableId
                  << ", \"internalName\": " << jsonString(o.identity.internalName)
                  << " }";
      }
      std::cout << " }";
      if (i + 1 < glHeader->objects.size()) std::cout << ',';
      std::cout << '\n';
    }
    std::cout << "    ]\n";
    std::cout << "  }";
  }
  std::cout << "\n}\n";
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

    // Best-effort GameLogic header decode.  Failures degrade gracefully —
    // some chunks may have unsupported versions on older saves.
    GameLogicHeader glHeader{};
    bool glHeaderValid = false;
    for (const auto& c : chunks) {
      if (c.blockName == "CHUNK_GameLogic") {
        try {
          glHeader = parseGameLogicHeader(bytes, c.blockDataOffset, c.blockSize);
          glHeaderValid = true;
        } catch (const std::exception& e) {
          std::fprintf(stderr, "oracle: CHUNK_GameLogic decode failed: %s\n", e.what());
        }
        break;
      }
    }

    emitJson(path, chunks, bytes.size(), glHeaderValid ? &glHeader : nullptr);
    return 0;
  } catch (const std::exception& e) {
    std::fprintf(stderr, "oracle: %s\n", e.what());
    return 1;
  }
}
