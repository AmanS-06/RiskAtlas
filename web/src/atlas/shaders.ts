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
  varying vec3 vObj;
  void main() {
    vObj = position;
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

const NOISE = /* glsl */ `
  float h31(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p) {
    return vnoise(p) * 0.55 + vnoise(p * 2.03 + 7.1) * 0.28 + vnoise(p * 4.1 + 3.7) * 0.17;
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
  varying vec3 vObj;
  varying vec3 vTerr;
  varying float vCover;
  varying float vDepth;
  ${NOISE}
  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(vView);

    // surface relief: muscle grain (stretched, slightly warped bands) over fine pitting, as a bump from screen-space derivatives
    vec3 q = vObj * 38.0;
    float warp = vnoise(q * 0.35) * 2.0;
    float grain = 0.5 + 0.5 * sin(dot(vObj, vec3(0.6, 1.0, 0.35)) * 95.0 + warp * 3.0);
    float height = fbm3(q) * 0.65 + grain * 0.22 + vnoise(q * 5.0) * 0.13;
    vec3 dpx = dFdx(vWorld);
    vec3 dpy = dFdy(vWorld);
    vec3 r1 = cross(dpy, N);
    vec3 r2 = cross(N, dpx);
    float det = dot(dpx, r1);
    vec3 grad = sign(det) * (dFdx(height) * r1 + dFdy(height) * r2);
    N = normalize(abs(det) * N - grad * 0.0016);
    if (dot(N, V) < 0.0) N = -N;

    // colour: slow mottling, thin bluish surface veins, a paler fatty sheen
    float mott = fbm3(vObj * 9.0 + 2.0);
    float ridge = 1.0 - abs(vnoise(vObj * 17.0 + 11.0) * 2.0 - 1.0);
    float vein = smoothstep(0.93, 0.995, ridge) * 0.55;
    vec3 albedo = uColor * (0.82 + 0.36 * mott);
    albedo = mix(albedo, albedo * vec3(0.55, 0.5, 0.75), vein);
    float fat = smoothstep(0.62, 0.8, fbm3(vObj * 6.0 + 20.0));
    albedo = mix(albedo, vec3(0.74, 0.58, 0.36) * 0.9, fat * 0.35);

    // light: a key from the upper right, a cool fill, a warm bounce from below, a rim from behind
    vec3 L1 = normalize(vec3(0.55, 0.8, 0.85));
    vec3 L2 = normalize(vec3(-0.75, 0.15, 0.45));
    vec3 L3 = normalize(vec3(0.0, -1.0, 0.25));
    vec3 L4 = normalize(vec3(-0.2, 0.4, -1.0));
    float wrap = 0.45; // light bleeding past the terminator, tinted red like tissue scattering
    float d1 = max((dot(N, L1) + wrap) / (1.0 + wrap), 0.0);
    float d1s = max(dot(N, L1), 0.0);
    vec3 scatter = vec3(0.9, 0.18, 0.1) * max(d1 - d1s, 0.0) * 0.9;
    float d2 = max(dot(N, L2), 0.0);
    float d3 = max(dot(N, L3), 0.0);
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.2) * max(dot(N, L4) * 0.5 + 0.5, 0.0);
    float cav = 0.7 + 0.3 * smoothstep(0.2, 0.8, height);
    vec3 diffuse = albedo * (0.2 + d1 * 0.95 + d2 * 0.28 * vec3(0.75, 0.9, 1.1) + d3 * 0.2 * vec3(1.0, 0.7, 0.55)) * cav;
    diffuse += scatter * albedo;

    // wet look: a broad sheen and a tight glint, broken up by the relief and a little wobble so it reads as moisture, not plastic
    vec3 H = normalize(L1 + V);
    float nh = max(dot(N, H), 0.0);
    float wet = 0.7 + 0.5 * vnoise(vObj * 24.0);
    float sheen = pow(nh, 14.0) * 0.14;
    float glint = pow(nh, 150.0) * 0.9 * wet;
    vec3 H2 = normalize(L2 + V);
    float glint2 = pow(max(dot(N, H2), 0.0), 80.0) * 0.25 * wet;
    float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    vec3 col = diffuse + vec3(1.0, 0.93, 0.88) * (sheen + glint + glint2) * (0.5 + 0.5 * fres + 0.5) + albedo * rim * 0.9 + vec3(0.5, 0.65, 0.9) * fres * 0.12;

    // risk territory over the muscle
    vec3 t = vTerr.x * uTerrCol[0] * uTerrAmt[0] + vTerr.y * uTerrCol[1] * uTerrAmt[1] + vTerr.z * uTerrCol[2] * uTerrAmt[2];
    float ts = uTerrOn * vCover;
    float k = clamp(length(t) * ts * 0.9, 0.0, 0.85);
    col = mix(col, col * 0.4 + t * (0.75 + 0.35 * uBeat) * (0.8 + 0.4 * mott), k);

    col += uColor * uHighlight * 0.4;
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
  uniform float uReal;
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vWorld;
  varying vec3 vObj;
  varying vec3 vTerr;
  varying float vCover;
  varying float vDepth;
  ${NOISE}
  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(vView);
    float fres = pow(1.0 - abs(dot(N, V)), 2.0);
    float flow = 0.5 + 0.5 * sin(dot(vWorld, vec3(2.0, 3.0, 1.3)) * 17.0 - uTime * 3.2);
    float core = uGlow * (0.72 + 0.28 * flow + 0.25 * uBeat);
    vec3 col = uColor * (core + fres * 0.7) + uColor * uHighlight * 0.9;
    float fade = mix(1.0, 0.62, smoothstep(uNear, uFar, vDepth));
    col *= fade;
    if (uReal > 0.5) {
      // lit like a vessel wall: soft diffuse, a wet streak along the tube, faint grain
      float g = vnoise(vObj * 60.0);
      vec3 L1 = normalize(vec3(0.55, 0.8, 0.85));
      float d = max((dot(N, L1) + 0.35) / 1.35, 0.0);
      vec3 H = normalize(L1 + V);
      float sp = pow(max(dot(N, H), 0.0), 70.0) * 0.7;
      vec3 lit = uColor * (0.3 + d * 0.9) * (0.9 + 0.2 * g) + vec3(1.0, 0.95, 0.9) * sp + uColor * uHighlight * 0.5;
      col = mix(lit, lit * (1.0 + 0.25 * uBeat), 0.6);
      col *= mix(1.0, 0.8, smoothstep(uNear, uFar, vDepth));
    }
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
  real: THREE.IUniform<number>;
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
    real: { value: 0 },
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
      uReal: shared.real,
    },
    vertexShader: COMMON_VERT,
    fragmentShader: VESSEL_FRAG,
  });
}
