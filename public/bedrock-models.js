// Minecraft Bedrock geometry helpers.
// Coordinates and UV rectangles are read in Bedrock pixels (16 pixels = 1 block).
const FACE_ORDER = ["east", "west", "up", "down", "south", "north"];

function faceUvSize(face, width, height, depth) {
  return {
    east: [depth, height],
    west: [depth, height],
    up: [width, depth],
    down: [width, depth],
    south: [width, height],
    north: [width, height]
  }[face];
}

function boxNetUvMap(origin, width, height, depth) {
  const [u, v] = origin;
  return {
    east: { uv: [u, v + depth], uv_size: [depth, height] },
    north: { uv: [u + depth, v + depth], uv_size: [width, height] },
    west: { uv: [u + depth + width, v + depth], uv_size: [depth, height] },
    south: { uv: [u + depth + width + depth, v + depth], uv_size: [width, height] },
    up: { uv: [u + depth, v], uv_size: [width, depth] },
    down: { uv: [u + depth + width, v], uv_size: [width, depth] }
  };
}

function rectForFace(face, width, height, depth, uvMap, mirror = false) {
  const dimensions = faceUvSize(face, width, height, depth);
  if (uvMap) {
    const entry = uvMap[face];
    if (!entry || !Array.isArray(entry.uv)) return null;
    return {
      uv: entry.uv,
      // Bedrock defaults omitted uv_size to the dimensions of that cube face.
      uvSize: Array.isArray(entry.uv_size) ? entry.uv_size : dimensions,
      rotation: Number(entry.uv_rotation) || 0,
      flipX: mirror && (face === "east" || face === "west")
    };
  }

  return { uv: [0, 0], uvSize: dimensions, rotation: 0, flipX: false };
}

function mapUv(rect, corner, textureWidth, textureHeight) {
  let x = corner[0];
  let y = corner[1];
  if (rect.flipX) x = 1 - x;
  const angle = ((rect.rotation % 360) + 360) % 360;
  if (angle === 90) [x, y] = [1 - y, x];
  else if (angle === 180) [x, y] = [1 - x, 1 - y];
  else if (angle === 270) [x, y] = [y, 1 - x];

  const px = rect.uv[0] + x * rect.uvSize[0];
  const py = rect.uv[1] + y * rect.uvSize[1];
  return [px / textureWidth, 1 - py / textureHeight];
}

/**
 * Creates six separately UV-mapped Minecraft block faces.
 * width/height/depth are in Bedrock pixels, not Three.js units.
 * A missing face in a Bedrock geometry UV object is intentionally omitted.
 */
export function createVoxelBoxGeometry(THREE, width, height, depth, uvMap = null, textureSize = [16, 16], options = {}) {
  const halfX = width / 32;
  const halfY = height / 32;
  const halfZ = depth / 32;
  const positions = [];
  const uvs = [];
  const indices = [];
  const groups = [];
  const faceDefinitions = [
    {
      name: "east",
      points: [[halfX, -halfY, halfZ], [halfX, -halfY, -halfZ], [halfX, halfY, -halfZ], [halfX, halfY, halfZ]],
      area: height * depth,
      reverse: false
    },
    {
      name: "west",
      points: [[-halfX, -halfY, -halfZ], [-halfX, -halfY, halfZ], [-halfX, halfY, halfZ], [-halfX, halfY, -halfZ]],
      area: height * depth,
      reverse: false
    },
    {
      name: "up",
      points: [[-halfX, halfY, -halfZ], [halfX, halfY, -halfZ], [halfX, halfY, halfZ], [-halfX, halfY, halfZ]],
      area: width * depth,
      reverse: true
    },
    {
      name: "down",
      points: [[-halfX, -halfY, halfZ], [halfX, -halfY, halfZ], [halfX, -halfY, -halfZ], [-halfX, -halfY, -halfZ]],
      area: width * depth,
      reverse: true
    },
    {
      name: "south",
      points: [[-halfX, -halfY, halfZ], [halfX, -halfY, halfZ], [halfX, halfY, halfZ], [-halfX, halfY, halfZ]],
      area: width * height,
      reverse: false
    },
    {
      name: "north",
      points: [[halfX, -halfY, -halfZ], [-halfX, -halfY, -halfZ], [-halfX, halfY, -halfZ], [halfX, halfY, -halfZ]],
      area: width * height,
      reverse: false
    }
  ];

  for (let faceIndex = 0; faceIndex < faceDefinitions.length; faceIndex += 1) {
    const face = faceDefinitions[faceIndex];
    if (face.area <= 0.000001) continue;
    const rect = rectForFace(face.name, width, height, depth, uvMap, options.mirror === true);
    if (!rect) continue;

    const baseVertex = positions.length / 3;
    const baseIndex = indices.length;
    // Bedrock face UVs are authored from the texture's top-left origin.
    // Side-face vertices are listed bottom-to-top, so flip the UV vertical
    // order there. Top/bottom faces retain their horizontal-plane orientation.
    const sideFace = ["east", "west", "south", "north"].includes(face.name);
    const imageCorners = sideFace
      ? [[0, 1], [1, 1], [1, 0], [0, 0]]
      : [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let corner = 0; corner < 4; corner += 1) {
      positions.push(...face.points[corner]);
      uvs.push(...mapUv(rect, imageCorners[corner], textureSize[0], textureSize[1]));
    }

    if (face.reverse) {
      indices.push(baseVertex, baseVertex + 2, baseVertex + 1, baseVertex, baseVertex + 3, baseVertex + 2);
    } else {
      indices.push(baseVertex, baseVertex + 1, baseVertex + 2, baseVertex, baseVertex + 2, baseVertex + 3);
    }
    groups.push({ start: baseIndex, count: 6, materialIndex: faceIndex });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  for (const group of groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Builds a Mojang/Bedrock .geo.json model, preserving bone/cube pivots,
 * rotations, face UV rectangles, UV flips, and material-instance labels.
 */
export function createBedrockGeometryModel(THREE, targetGroup, file, getMaterial) {
  const geometryDefinition = file?.["minecraft:geometry"]?.[0];
  if (!geometryDefinition) return false;

  for (const bone of geometryDefinition.bones || []) {
    const bonePivot = Array.isArray(bone.pivot) ? bone.pivot : [0, 0, 0];
    const boneGroup = new THREE.Group();
    boneGroup.position.set(bonePivot[0] / 16, (bonePivot[1] - 8) / 16, bonePivot[2] / 16);
    if (Array.isArray(bone.rotation)) {
      boneGroup.rotation.set(
        (bone.rotation[0] || 0) * Math.PI / 180,
        (bone.rotation[1] || 0) * Math.PI / 180,
        (bone.rotation[2] || 0) * Math.PI / 180
      );
    }
    targetGroup.add(boneGroup);

    for (const cube of bone.cubes || []) {
      if (!Array.isArray(cube.origin) || !Array.isArray(cube.size)) continue;
      const [width, height, depth] = cube.size;
      const uvMap = Array.isArray(cube.uv)
        ? boxNetUvMap(cube.uv, width, height, depth)
        : (cube.uv && typeof cube.uv === "object" ? cube.uv : null);
      const cubeMirror = typeof cube.mirror === "boolean" ? cube.mirror : bone.mirror === true;
      const materials = FACE_ORDER.map((face) => {
        const definition = uvMap?.[face];
        return definition
          ? getMaterial(definition.material_instance || "*", face)
          : getMaterial("*", face);
      });
      const geometry = createVoxelBoxGeometry(
        THREE, width, height, depth, uvMap,
        [geometryDefinition.description?.texture_width || 16, geometryDefinition.description?.texture_height || 16],
        { mirror: cubeMirror }
      );

      const mesh = new THREE.Mesh(geometry, materials);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const cubePivot = Array.isArray(cube.pivot) ? cube.pivot : bonePivot;
      const cubeGroup = new THREE.Group();
      cubeGroup.position.set(
        (cubePivot[0] - bonePivot[0]) / 16,
        (cubePivot[1] - bonePivot[1]) / 16,
        (cubePivot[2] - bonePivot[2]) / 16
      );
      if (Array.isArray(cube.rotation)) {
        cubeGroup.rotation.set(
          (cube.rotation[0] || 0) * Math.PI / 180,
          (cube.rotation[1] || 0) * Math.PI / 180,
          (cube.rotation[2] || 0) * Math.PI / 180
        );
      }
      mesh.position.set(
        (cube.origin[0] + width / 2 - cubePivot[0]) / 16,
        (cube.origin[1] + height / 2 - cubePivot[1]) / 16,
        (cube.origin[2] + depth / 2 - cubePivot[2]) / 16
      );
      cubeGroup.add(mesh);
      boneGroup.add(cubeGroup);
    }
  }
  return true;
}