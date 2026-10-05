// Materials of the Atlas heart. Three looks share two shader families: a translucent "hologram" shell for the body and a glowing tube for the arteries.
// Colours are always passed in as THREE.Color (linear working space); nothing here knows about risk, only about colour, glow and dimming.

import * as THREE from 'three';

const COMMON_VERT = /* glsl */ `
  attribute vec3 aTerr;
  attribute float aCover;
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vWorld;
  varying vec3 vTerr;
  varying float vCover;
  varying float vDepth;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 mv = viewMatrix * wp;
    vView = -mv.xyz;
    vDepth = -mv.z;
    vTerr = aTerr;
    vCover = aCover;
    gl_Position = projectionMatrix * mv;
  }
`;

const HOLO_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uHighlight;
  uniform float uDim;
  uniform float uOpacity;
  uniform float uScanY;
  uniform float uScanAmt;
  uniform float uBeat;
  uniform float uTerrOn;
  uniform vec3 uTerrCol[3];
  uniform float uTerrAmt[3];
  uniform float uNear;
  uniform float uFar;
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vWorld;
  varying vec3 vTerr;
  varying float vCover;
  varying float vDepth;
  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(vView);
    float fres = pow(1.0 - abs(dot(N, V)), 2.2);
    float lines = 0.5 + 0.5 * sin(vWorld.y * 150.0 - uTime * 1.1);
    lines = mix(1.0, 0.62 + 0.38 * lines, 0.55);
    vec3 col = uColor * (0.16 + fres * 1.25) * lines;
    float a = (0.09 + fres * 0.72) * uOpacity;

    vec3 t = vTerr.x * uTerrCol[0] * uTerrAmt[0] + vTerr.y * uTerrCol[1] * uTerrAmt[1] + vTerr.z * uTerrCol[2] * uTerrAmt[2];
    float ts = uTerrOn * vCover;
    // the territory replaces the cyan with the artery's own risk colour (adding would mix cyan and red into white)
    float k = clamp(length(t) * ts * 0.95, 0.0, 0.88);
    vec3 tc = t / max(max(t.r, max(t.g, t.b)), 1e-3);
    col = mix(col, tc * (0.72 + 0.45 * uBeat) * (0.6 + 0.4 * lines), k);
    a = mix(a, max(a, 0.5), k);

    float scan = smoothstep(0.07, 0.0, abs(vWorld.y - uScanY)) * uScanAmt;
    col += vec3(0.55, 0.95, 1.0) * scan * 1.4;
    a += scan * 0.55;

    col += uColor * uHighlight * 0.8;
    a += uHighlight * 0.22;

    float fade = mix(1.0, 0.5, smoothstep(uNear, uFar, vDepth));
    col *= fade;
    a *= uDim * fade;
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
    #include <colorspace_fragment>
  }
`;

const REAL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uHighlight;
  uniform float uDim;
  uniform float uBeat;
  uniform float uTerrOn;
  uniform vec3 uTerrCol[3];
  uniform float uTerrAmt[3];
  uniform float uScanY;
  uniform float uScanAmt;
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vWorld;
  varying vec3 vTerr;
  varying float vCover;
  varying float vDepth;
  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(vView);
    vec3 L1 = normalize(vec3(0.5, 0.8, 0.9));
    vec3 L2 = normalize(vec3(-0.7, 0.1, 0.4));
    float diff = max(dot(N, L1), 0.0) * 0.85 + max(dot(N, L2), 0.0) * 0.28;
    vec3 H = normalize(L1 + V);
    float spec = pow(max(dot(N, H), 0.0), 38.0) * 0.45;
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    vec3 base = uColor * (0.28 + diff);
    vec3 t = vTerr.x * uTerrCol[0] * uTerrAmt[0] + vTerr.y * uTerrCol[1] * uTerrAmt[1] + vTerr.z * uTerrCol[2] * uTerrAmt[2];
    float ts = uTerrOn * vCover;
    base = mix(base, base * 0.35 + t * (0.9 + 0.4 * uBeat), clamp(length(t) * ts * 0.9, 0.0, 0.85));
    vec3 col = base + vec3(spec) + uColor * fres * 0.35 + uColor * uHighlight * 0.45;
    float scan = smoothstep(0.07, 0.0, abs(vWorld.y - uScanY)) * uScanAmt;
    col += vec3(0.5, 0.8, 1.0) * scan * 0.9;
    col = mix(vec3(dot(col, vec3(0.3333))) * 0.6, col, uDim);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const VESSEL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uHighlight;
  uniform float uDim;
  uniform float uGlow;
  uniform float uBeat;
  uniform float uNear;
  uniform float uFar;
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vWorld;
  varying vec3 vTerr;
  varying float vCover;
  varying float vDepth;
  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(vView);
    float fres = pow(1.0 - abs(dot(N, V)), 2.0);
    float flow = 0.5 + 0.5 * sin(dot(vWorld, vec3(2.0, 3.0, 1.3)) * 17.0 - uTime * 3.2);
    float core = uGlow * (0.72 + 0.28 * flow + 0.25 * uBeat);
    vec3 col = uColor * (core + fres * 0.7) + uColor * uHighlight * 0.9;
    float fade = mix(1.0, 0.62, smoothstep(uNear, uFar, vDepth));
    col *= fade;
    col = mix(vec3(dot(col, vec3(0.3333))) * 0.55, col, uDim);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export interface BodyUniforms {
  [k: string]: THREE.IUniform;
  uColor: THREE.IUniform<THREE.Color>;
  uTime: THREE.IUniform<number>;
  uHighlight: THREE.IUniform<number>;
  uDim: THREE.IUniform<number>;
  uOpacity: THREE.IUniform<number>;
  uScanY: THREE.IUniform<number>;
  uScanAmt: THREE.IUniform<number>;
  uBeat: THREE.IUniform<number>;
  uTerrOn: THREE.IUniform<number>;
  uTerrCol: THREE.IUniform<THREE.Color[]>;
  uTerrAmt: THREE.IUniform<number[]>;
  uNear: THREE.IUniform<number>;
  uFar: THREE.IUniform<number>;
}

export interface Shared {
  time: THREE.IUniform<number>;
  scanY: THREE.IUniform<number>;
  scanAmt: THREE.IUniform<number>;
  beat: THREE.IUniform<number>;
  terrOn: THREE.IUniform<number>;
  terrCol: THREE.IUniform<THREE.Color[]>;
  terrAmt: THREE.IUniform<number[]>;
  near: THREE.IUniform<number>;
  far: THREE.IUniform<number>;
}

export function makeShared(): Shared {
  return {
    time: { value: 0 },
    scanY: { value: 0 },
    scanAmt: { value: 0 },
    beat: { value: 0 },
    terrOn: { value: 1 },
    terrCol: { value: [new THREE.Color('#888888'), new THREE.Color('#888888'), new THREE.Color('#888888')] },
    terrAmt: { value: [0, 0, 0] },
    near: { value: 2 },
    far: { value: 4 },
  };
}

function bodyUniforms(shared: Shared, color: string, opacity: number): BodyUniforms {
  return {
    uColor: { value: new THREE.Color(color) },
    uTime: shared.time,
    uHighlight: { value: 0 },
    uDim: { value: 1 },
    uOpacity: { value: opacity },
    uScanY: shared.scanY,
    uScanAmt: shared.scanAmt,
    uBeat: shared.beat,
    uTerrOn: shared.terrOn,
    uTerrCol: shared.terrCol,
    uTerrAmt: shared.terrAmt,
    uNear: shared.near,
    uFar: shared.far,
  };
}

export function holoMaterial(shared: Shared, color: string, opacity = 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: bodyUniforms(shared, color, opacity),
    vertexShader: COMMON_VERT,
    fragmentShader: HOLO_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
}

export function realMaterial(shared: Shared, color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: bodyUniforms(shared, color, 1),
    vertexShader: COMMON_VERT,
    fragmentShader: REAL_FRAG,
    side: THREE.DoubleSide,
  });
}

export function vesselMaterial(shared: Shared, color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: shared.time,
      uHighlight: { value: 0 },
      uDim: { value: 1 },
      uGlow: { value: 1.15 },
      uBeat: shared.beat,
      uNear: shared.near,
      uFar: shared.far,
    },
    vertexShader: COMMON_VERT,
    fragmentShader: VESSEL_FRAG,
  });
}
