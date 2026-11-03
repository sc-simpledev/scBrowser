import { LAND_BITS, LAND_HEIGHT, LAND_WIDTH } from './land'

const VERTEX = `#version 300 es
in vec2 corner;
void main() { gl_Position = vec4(corner, 0.0, 1.0); }`

/** The Earth is one analytic sphere, so it stays sharp however close the camera comes. */
const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uSize;
uniform vec2 uShift;
uniform float uDistance;
uniform float uSpin;
uniform float uLit;
uniform float uStars;
uniform float uLight;
uniform vec3 uSun;
uniform vec3 uTint;
uniform sampler2D uLand;
out vec4 color;

const float PI = 3.14159265;
const float ROWS = 260.0;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec3 stars(vec3 ray) {
  vec2 grid = vec2(atan(ray.x, ray.z), asin(ray.y)) * 90.0;
  vec2 cell = floor(grid);
  float seed = hash(cell);
  if (seed < 0.965) return vec3(0.0);
  vec2 spot = fract(grid) - 0.5 - (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.7;
  float size = 0.04 + 0.1 * hash(cell + 1.3);
  return vec3(0.75, 0.86, 1.0) * smoothstep(size, 0.0, length(spot)) * (seed - 0.96) * 26.0;
}

/** One lit dot per cell, in rows that thin out towards the poles. */
float landDots(vec3 q, float lat, float lon, out float cellSeed) {
  float row = floor((lat / PI + 0.5) * ROWS);
  float centre = ((row + 0.5) / ROWS - 0.5) * PI;
  float columns = max(1.0, floor(2.0 * ROWS * cos(centre)));
  float column = floor((lon / (2.0 * PI) + 0.5) * columns);
  float centreLon = ((column + 0.5) / columns - 0.5) * 2.0 * PI;
  cellSeed = hash(vec2(row, column));
  float land = texture(uLand, vec2(centreLon / (2.0 * PI) + 0.5, 0.5 - centre / PI)).r;
  if (land < 0.5) return 0.0;
  vec2 offset = vec2((lon - centreLon) * cos(centre), lat - centre) * ROWS / PI;
  float blur = clamp(fwidth(lat) * ROWS / PI, 0.07, 0.5);
  return smoothstep(0.38 + blur, 0.3 - blur * 0.5, length(offset));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uSize) / uSize.y - uShift;
  vec3 origin = vec3(0.0, 0.0, uDistance);
  vec3 ray = normalize(vec3(uv, -1.7));
  vec3 sun = normalize(uSun);

  float b = dot(origin, ray);
  float c = dot(origin, origin) - 1.0;
  float h = b * b - c;
  bool hit = h > 0.0 && b < 0.0;
  vec3 result = stars(ray) * uStars;
  // The daytime scene: a pale planet on paper, with the same geometry and camera.
  vec3 paperSky = vec3(0.957, 0.969, 0.973);
  vec3 ink = mix(uTint, vec3(0.05, 0.12, 0.15), 0.42);
  vec3 paper = paperSky;

  if (hit) {
    float depth = -b - sqrt(h);
    vec3 n = normalize(origin + ray * depth);
    float s = sin(uSpin), k = cos(uSpin);
    float tilt = 0.32;
    vec3 tilted = vec3(n.x, n.y * cos(tilt) - n.z * sin(tilt), n.y * sin(tilt) + n.z * cos(tilt));
    vec3 q = vec3(tilted.x * k + tilted.z * s, tilted.y, -tilted.x * s + tilted.z * k);
    float lat = asin(clamp(q.y, -1.0, 1.0));
    float lon = atan(q.x, q.z);

    float light = dot(n, sun);
    float day = smoothstep(-0.2, 0.45, light);
    float seed;
    float dots = landDots(q, lat, lon, seed);
    float twinkle = 0.65 + 0.35 * sin(uSpin * 40.0 + seed * 60.0);

    vec3 ocean = uTint * (0.015 + 0.09 * day);
    vec3 lit = mix(uTint, vec3(1.0), 0.55) * (0.32 + 0.8 * day);
    vec3 night = mix(uTint, vec3(1.0), 0.4) * step(0.72, seed) * twinkle * (1.0 - day) * 0.75;
    result = (ocean + dots * (lit + night)) * uLit;

    // Thin air seen edge-on, brightest where the sun is coming through.
    float edge = pow(1.0 - max(dot(n, -ray), 0.0), 3.2);
    result += mix(uTint, vec3(0.92, 0.98, 1.0), 0.35) * edge * (0.08 + 0.9 * smoothstep(-0.25, 0.3, light));

    vec3 sphere = mix(vec3(0.885, 0.91, 0.918), vec3(0.992, 0.995, 0.996), 0.35 + 0.65 * day);
    paper = mix(vec3(0.9, 0.922, 0.93), sphere, min(uLit + 0.25, 1.0));
    paper = mix(paper, ink, dots * (0.55 + 0.3 * step(0.72, seed) * twinkle) * min(uLit, 1.0));
    paper = mix(paper, mix(uTint, vec3(1.0), 0.45), edge * (0.2 + 0.6 * smoothstep(-0.25, 0.3, light)));
  } else {
    // The glow around the planet, from the closest the ray gets to it.
    vec3 nearest = origin + ray * max(-b, 0.0);
    float height = length(nearest) - 1.0;
    float toward = max(dot(normalize(nearest), sun), 0.0);
    float scatter = exp(-height * 15.0) * (0.03 + pow(toward, 3.0) * 1.15) + exp(-height * 4.0) * pow(toward, 6.0) * 0.16;
    result += mix(uTint, vec3(0.92, 0.98, 1.0), exp(-height * 26.0) * 0.7) * scatter;
    paper = mix(paperSky, mix(uTint, vec3(1.0), 0.28 + exp(-height * 22.0) * 0.5), clamp(scatter * 1.1, 0.0, 0.8));
    float aim = max(dot(ray, sun), 0.0);
    result += vec3(1.0, 0.98, 0.94) * (pow(aim, 5200.0) * 5.0 + pow(aim, 180.0) * 0.32);
    paper = mix(paper, vec3(1.0), clamp(pow(aim, 5200.0) * 5.0 + pow(aim, 120.0) * 0.8, 0.0, 1.0));
    // The long level streak a real lens gives a bright point.
    if (sun.z < 0.0) {
      vec2 point = sun.xy / -sun.z * 1.7;
      result += mix(uTint, vec3(1.0), 0.5) * exp(-abs(uv.y - point.y) * 90.0) * exp(-abs(uv.x - point.x) * 1.8) * 0.42 * smoothstep(0.0, 0.5, uStars);
    }
  }

  // Filmic curve, a soft vignette, and a little grain so the dark gradients don't band.
  result = result / (1.0 + result * 0.65);
  vec2 centre = gl_FragCoord.xy / uSize - 0.5;
  result *= 1.0 - dot(centre, centre) * 0.7;
  result += (hash(gl_FragCoord.xy + uSpin) - 0.5) / 160.0;
  vec3 night = pow(max(result, 0.0), vec3(0.88));
  vec3 daytime = paper * (1.0 - dot(centre, centre) * 0.12) + (hash(gl_FragCoord.xy + uSpin) - 0.5) / 200.0;
  color = vec4(mix(night, daytime, uLight), 1.0);
}`

export interface Shot {
  distance: number
  shift: [number, number]
  sun: [number, number, number]
  lit: number
  stars: number
}

/** Cities the light travels between, as latitude and longitude. */
const CITIES: [number, number][] = [
  [-33.9, 151.2],
  [35.7, 139.7],
  [1.35, 103.8],
  [51.5, -0.1],
  [40.7, -74],
  [37.8, -122.4],
  [19.1, 72.9]
]
const ROUTE_SECONDS = 3.2
const TILT = 0.32

function maskTexture(): Uint8Array {
  const bits = Uint8Array.from(atob(LAND_BITS), (c) => c.charCodeAt(0))
  const pixels = new Uint8Array(LAND_WIDTH * LAND_HEIGHT)
  for (let i = 0; i < pixels.length; i++) pixels[i] = bits[i >> 3]! & (1 << (i & 7)) ? 255 : 0
  return pixels
}

const fromLatLon = ([lat, lon]: [number, number]): [number, number, number] => {
  const a = (lat * Math.PI) / 180
  const o = (lon * Math.PI) / 180
  return [Math.cos(a) * Math.sin(o), Math.sin(a), Math.cos(a) * Math.cos(o)]
}

export interface Globe {
  /** `light` runs from 0 for the night scene to 1 for the daytime one. */
  draw: (shot: Shot, seconds: number, tint: [number, number, number], light: number) => void
  resize: () => void
  destroy: () => void
}

/** Null where WebGL 2 isn't available; the page falls back to a plain dark gradient. */
export function createGlobe(canvas: HTMLCanvasElement, trails: HTMLCanvasElement): Globe | null {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' })
  const ink = trails.getContext('2d')
  if (!gl || !ink) return null

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(shader))
    return shader
  }
  const program = gl.createProgram()
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX))
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null
  gl.useProgram(program)

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const corner = gl.getAttribLocation(program, 'corner')
  gl.enableVertexAttribArray(corner)
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0)

  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, LAND_WIDTH, LAND_HEIGHT, 0, gl.RED, gl.UNSIGNED_BYTE, maskTexture())
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  const uniform = (name: string) => gl.getUniformLocation(program, name)
  const u = {
    size: uniform('uSize'),
    shift: uniform('uShift'),
    distance: uniform('uDistance'),
    spin: uniform('uSpin'),
    lit: uniform('uLit'),
    stars: uniform('uStars'),
    light: uniform('uLight'),
    sun: uniform('uSun'),
    tint: uniform('uTint')
  }

  let quality = Math.min(window.devicePixelRatio || 1, 1.5)
  let last = 0
  let slow = 0
  const resize = () => {
    canvas.width = Math.round(innerWidth * quality)
    canvas.height = Math.round(innerHeight * quality)
    trails.width = innerWidth
    trails.height = innerHeight
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.uniform2f(u.size, canvas.width, canvas.height)
  }
  resize()

  /** Where a point on the Earth lands on screen, or null if it's round the back. */
  const project = (p: [number, number, number], shot: Shot, spin: number): [number, number] | null => {
    const s = Math.sin(spin)
    const k = Math.cos(spin)
    const x = p[0] * k - p[2] * s
    const z1 = p[0] * s + p[2] * k
    const y = p[1] * Math.cos(TILT) + z1 * Math.sin(TILT)
    const z = -p[1] * Math.sin(TILT) + z1 * Math.cos(TILT)
    const toCamera = shot.distance - z
    // Round the far side of the horizon, seen from the camera.
    if (z < 1 / shot.distance) return null
    const scale = 1.7 / toCamera
    return [innerWidth / 2 + (x * scale + shot.shift[0]) * innerHeight, innerHeight / 2 - (y * scale + shot.shift[1]) * innerHeight]
  }

  const drawTrails = (shot: Shot, seconds: number, spin: number, tint: [number, number, number], light: number) => {
    ink.clearRect(0, 0, innerWidth, innerHeight)
    if (shot.lit < 0.4) return
    ink.lineCap = 'round'
    // Bright lines on the night side, and deeper ones on pale paper.
    const [r, g, b] = tint.map((value) => Math.round(value * 255 * (0.5 + light * 0.2) + 127 * (1 - light)))
    for (let route = 0; route < CITIES.length; route++) {
      const progress = (seconds / ROUTE_SECONDS + route * 0.37) % 1
      const from = fromLatLon(CITIES[route]!)
      const to = fromLatLon(CITIES[(route * 2 + 3) % CITIES.length]!)
      let previous: [number, number] | null = null
      const STEPS = 48
      for (let step = 0; step <= STEPS; step++) {
        const t = step / STEPS
        if (t > progress * 1.4 || t < progress * 1.4 - 0.5) {
          previous = null
          continue
        }
        const lift = 1 + Math.sin(t * Math.PI) * 0.2
        const mix = from.map((value, axis) => value + (to[axis]! - value) * t)
        const length = Math.hypot(...mix)
        const point = project(mix.map((value) => (value / length) * lift) as [number, number, number], shot, spin)
        if (point && previous) {
          const fade = Math.sin(((t - (progress * 1.4 - 0.5)) / 0.5) * Math.PI) * Math.min(1, (shot.lit - 0.4) * 2)
          ink.strokeStyle = `rgba(${r}, ${g}, ${b}, ${fade * 0.5})`
          ink.lineWidth = 0.5 + fade * 0.7
          ink.beginPath()
          ink.moveTo(...previous)
          ink.lineTo(...point)
          ink.stroke()
        }
        previous = point
      }
    }
  }

  return {
    resize,
    draw: (shot, seconds, tint, light) => {
      // Slower machines get fewer pixels rather than a stutter.
      const now = performance.now()
      slow = now - last > 34 ? slow + 1 : Math.max(0, slow - 1)
      last = now
      if (slow > 24 && quality > 0.6) {
        quality *= 0.75
        slow = 0
        resize()
      }
      const spin = 2.2 + seconds * 0.05
      gl.uniform2f(u.shift, shot.shift[0], shot.shift[1])
      gl.uniform1f(u.distance, shot.distance)
      gl.uniform1f(u.spin, spin)
      gl.uniform1f(u.lit, shot.lit)
      gl.uniform1f(u.stars, shot.stars)
      gl.uniform1f(u.light, light)
      gl.uniform3f(u.sun, ...shot.sun)
      gl.uniform3f(u.tint, ...tint)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      drawTrails(shot, seconds, spin, tint, light)
    },
    destroy: () => gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
