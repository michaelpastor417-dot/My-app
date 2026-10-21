import type { ResolvedLook } from '../timeline/look';
import type { SourceRect } from './geometry';

/**
 * WebGL2 image processing for the compositor: colour grading + effects for a
 * single clip, and transitions between two full-canvas layers. Everything
 * renders into one shared offscreen canvas, which the caller draws onto the
 * 2D preview canvas straight away (before the next GPU call reuses it).
 */

const VERTEX = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const COMMON = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;

const LOOK_FRAGMENT = `${COMMON}
uniform sampler2D u_tex;
uniform vec4 u_crop;      // cropped region of the texture: offset.xy, size.zw (texture uv)
uniform vec2 u_srcPx;     // cropped region size in source pixels
uniform vec2 u_outSize;
uniform float u_time;
uniform float u_brightness, u_contrast, u_saturation, u_exposure, u_temperature, u_tint;
uniform float u_highlights, u_shadows, u_sharpen, u_vignette;
uniform vec3 u_splitShadows, u_splitHighlights;
uniform int u_effect;
uniform float u_intensity;

vec4 src(vec2 uv) { return texture(u_tex, u_crop.xy + clamp(uv, 0.0, 1.0) * u_crop.zw); }

void main() {
  vec2 uv = v_uv;
  float k = u_intensity;
  float aspect = u_outSize.y / u_outSize.x;

  // Effects that move pixels around.
  if (u_effect == 7) uv.x = uv.x < 0.5 ? uv.x : 1.0 - uv.x;                       // mirror
  if (u_effect == 8) uv += vec2(sin(u_time * 47.0), cos(u_time * 61.0)) * 0.015 * k; // shake
  if (u_effect == 5) {                                                             // pixelate
    vec2 grid = vec2(1.0, aspect) * mix(320.0, 16.0, k);
    uv = (floor(uv * grid) + 0.5) / grid;
  }
  float glitch = 0.0;
  if (u_effect == 3) {                                                             // glitch: jumping slices
    float tick = floor(u_time * 12.0);
    float band = floor(uv.y * 24.0);
    if (hash(vec2(band, tick)) > 0.75) glitch = (hash(vec2(band + 7.0, tick)) - 0.5) * 0.15 * k;
    uv.x += glitch;
  }

  vec4 c;
  if (u_effect == 1) {                                                             // gaussian-ish blur
    vec2 r = vec2(aspect, 1.0) * 0.015 * k;
    float total = 0.0;
    c = vec4(0.0);
    for (int i = -3; i <= 3; i++) for (int j = -3; j <= 3; j++) {
      vec2 o = vec2(float(i), float(j)) / 3.0;
      float w = exp(-dot(o, o) * 2.0);
      c += src(uv + o * r) * w;
      total += w;
    }
    c /= total;
  } else if (u_effect == 3 || u_effect == 4) {                                     // colour channels split apart
    float off = (u_effect == 4 ? 0.012 * k : 0.006 * k) + abs(glitch) * 0.3;
    vec4 base = src(uv);
    c = vec4(src(uv + vec2(off, 0.0)).r, base.g, src(uv - vec2(off, 0.0)).b, base.a);
  } else {
    c = src(uv);
  }

  vec3 col = c.rgb;
  if (u_sharpen > 0.0) {
    vec2 d = 1.0 / u_srcPx;
    vec3 around = src(uv + vec2(d.x, 0.0)).rgb + src(uv - vec2(d.x, 0.0)).rgb
                + src(uv + vec2(0.0, d.y)).rgb + src(uv - vec2(0.0, d.y)).rgb;
    col += (col * 4.0 - around) * u_sharpen * 0.8;
  }

  // Colour grading.
  col *= exp2(u_exposure * 1.5);
  col += u_brightness * 0.25;
  col = (col - 0.5) * (1.0 + u_contrast * (u_contrast > 0.0 ? 1.0 : 0.8)) + 0.5;
  float l = dot(col, LUMA);
  col += u_shadows * 0.3 * (1.0 - smoothstep(0.0, 0.5, l));
  col += u_highlights * 0.3 * smoothstep(0.5, 1.0, l);
  col += vec3(u_temperature * 0.08 + u_tint * 0.03, -u_tint * 0.08, -u_temperature * 0.08 + u_tint * 0.03);
  col = mix(vec3(dot(col, LUMA)), col, 1.0 + u_saturation);
  l = clamp(dot(col, LUMA), 0.0, 1.0);
  col += u_splitShadows * (1.0 - l) + u_splitHighlights * l;

  float vignette = u_vignette + (u_effect == 2 ? k : 0.0);
  if (vignette > 0.0) {
    vec2 p = (v_uv - 0.5) * vec2(1.0, aspect) * 1.6;
    col *= 1.0 - min(vignette, 1.0) * smoothstep(0.35, 1.0, length(p));
  }
  if (u_effect == 6) col += (hash(v_uv * u_outSize + fract(u_time) * 100.0) - 0.5) * 0.3 * k; // film grain

  col = clamp(col, 0.0, 1.0);
  outColor = vec4(col * c.a, c.a); // premultiplied for the 2D canvas
}`;

const TRANSITION_FRAGMENT = `${COMMON}
uniform sampler2D u_from, u_to;  // premultiplied canvas-sized layers
uniform float u_p;
uniform int u_type;
uniform vec2 u_size;

bool inside(vec2 uv) { return all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0))); }
vec4 A(vec2 uv) { return inside(uv) ? texture(u_from, uv) : vec4(0.0); }
vec4 B(vec2 uv) { return inside(uv) ? texture(u_to, uv) : vec4(0.0); }
vec4 blurred(sampler2D t, vec2 uv, float r) {
  vec4 c = vec4(0.0);
  for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) c += texture(t, uv + vec2(float(i), float(j)) * r);
  return c / 25.0;
}

void main() {
  vec2 uv = v_uv;
  float p = u_p;
  float e = p * p * (3.0 - 2.0 * p); // ease in-out
  vec4 c;
  if (u_type == 1 || u_type == 2) {                    // dip to black / white
    vec4 mid = u_type == 1 ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(1.0);
    c = p < 0.5 ? mix(A(uv), mid, p * 2.0) : mix(mid, B(uv), p * 2.0 - 1.0);
  } else if (u_type == 3) {                            // slide left: B pushes A out
    c = uv.x < 1.0 - e ? A(uv + vec2(e, 0.0)) : B(uv - vec2(1.0 - e, 0.0));
  } else if (u_type == 4) {                            // slide up: B rises from the bottom
    c = uv.y < e ? B(uv + vec2(0.0, 1.0 - e)) : A(uv - vec2(0.0, e));
  } else if (u_type == 5) {                            // wipe from the right edge
    c = mix(A(uv), B(uv), smoothstep(1.0 - e - 0.02, 1.0 - e + 0.02, uv.x));
  } else if (u_type == 6) {                            // zoom into A, then dissolve
    vec4 zoomed = A((uv - 0.5) / (1.0 + e * 0.8) + 0.5);
    c = mix(zoomed, B(uv), smoothstep(0.35, 1.0, p));
  } else if (u_type == 7) {                            // circle opening from the centre
    vec2 d = (uv - 0.5) * vec2(u_size.x / u_size.y, 1.0);
    float r = e * length(vec2(u_size.x / u_size.y, 1.0)) * 0.5;
    c = mix(B(uv), A(uv), smoothstep(r - 0.01, r + 0.01, length(d)));
  } else if (u_type == 8) {                            // blur out, blur in
    float r = sin(p * 3.14159) * 0.006;
    c = mix(blurred(u_from, uv, r), blurred(u_to, uv, r), e);
  } else {                                             // dissolve
    c = mix(A(uv), B(uv), p);
  }
  outColor = c;
}`;

const LOOK_UNIFORMS = [
  'u_tex', 'u_crop', 'u_srcPx', 'u_outSize', 'u_time', 'u_brightness', 'u_contrast', 'u_saturation',
  'u_exposure', 'u_temperature', 'u_tint', 'u_highlights', 'u_shadows', 'u_sharpen', 'u_vignette',
  'u_splitShadows', 'u_splitHighlights', 'u_effect', 'u_intensity',
] as const;
const TRANSITION_UNIFORMS = ['u_from', 'u_to', 'u_p', 'u_type', 'u_size'] as const;

type Program<U extends string> = { program: WebGLProgram; u: Record<U, WebGLUniformLocation | null> };

export class GpuRenderer {
  readonly canvas = document.createElement('canvas');
  private gl: WebGL2RenderingContext;
  private look: Program<(typeof LOOK_UNIFORMS)[number]>;
  private transitionProgram: Program<(typeof TRANSITION_UNIFORMS)[number]>;
  private textures: [WebGLTexture, WebGLTexture];

  /** Returns null when the browser has no WebGL2; callers then skip GPU effects. */
  static create(): GpuRenderer | null {
    try {
      return new GpuRenderer();
    } catch (e) {
      console.error('GPU effects unavailable:', e);
      return null;
    }
  }

  private constructor() {
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.look = this.compile(LOOK_FRAGMENT, LOOK_UNIFORMS);
    this.transitionProgram = this.compile(TRANSITION_FRAGMENT, TRANSITION_UNIFORMS);
    this.textures = [this.makeTexture(), this.makeTexture()];

    // One quad covering the viewport, shared by both programs (a_pos is attribute 0 in each).
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // Textures are uploaded upside down so texture v=0 is the bottom of the image, matching v_uv.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  }

  /**
   * Colour-grade and apply effects to the `src` region of a clip's frame.
   * Returns the shared GPU canvas (outW × outH) holding the result.
   */
  processClip(
    source: TexImageSource,
    sourceW: number,
    sourceH: number,
    src: SourceRect,
    look: ResolvedLook,
    time: number,
    outW: number,
    outH: number,
  ): HTMLCanvasElement {
    const { gl } = this;
    const { program, u } = this.look;
    this.begin(outW, outH, program);
    this.upload(0, source, false);
    gl.uniform1i(u.u_tex, 0);
    gl.uniform4f(u.u_crop, src.sx / sourceW, 1 - (src.sy + src.sh) / sourceH, src.sw / sourceW, src.sh / sourceH);
    gl.uniform2f(u.u_srcPx, src.sw, src.sh);
    gl.uniform2f(u.u_outSize, outW, outH);
    gl.uniform1f(u.u_time, time);
    const a = look.adjust;
    gl.uniform1f(u.u_brightness, a.brightness);
    gl.uniform1f(u.u_contrast, a.contrast);
    gl.uniform1f(u.u_saturation, a.saturation);
    gl.uniform1f(u.u_exposure, a.exposure);
    gl.uniform1f(u.u_temperature, a.temperature);
    gl.uniform1f(u.u_tint, a.tint);
    gl.uniform1f(u.u_highlights, a.highlights);
    gl.uniform1f(u.u_shadows, a.shadows);
    gl.uniform1f(u.u_sharpen, a.sharpen);
    gl.uniform1f(u.u_vignette, a.vignette);
    gl.uniform3f(u.u_splitShadows, ...look.splitShadows);
    gl.uniform3f(u.u_splitHighlights, ...look.splitHighlights);
    gl.uniform1i(u.u_effect, look.effect);
    gl.uniform1f(u.u_intensity, look.effectIntensity);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }

  /** Blend two canvas-sized layers. `type` is a TRANSITION_CODES value, `progress` 0..1. */
  transition(from: TexImageSource, to: TexImageSource, type: number, progress: number, w: number, h: number) {
    const { gl } = this;
    const { program, u } = this.transitionProgram;
    this.begin(w, h, program);
    this.upload(0, from, true);
    this.upload(1, to, true);
    gl.uniform1i(u.u_from, 0);
    gl.uniform1i(u.u_to, 1);
    gl.uniform1f(u.u_p, progress);
    gl.uniform1i(u.u_type, type);
    gl.uniform2f(u.u_size, w, h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }

  private begin(w: number, h: number, program: WebGLProgram) {
    const { gl, canvas } = this;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
  }

  private upload(unit: number, source: TexImageSource, premultiply: boolean) {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[unit]);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  private makeTexture(): WebGLTexture {
    const { gl } = this;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private compile<U extends string>(fragment: string, uniforms: readonly U[]): Program<U> {
    const { gl } = this;
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(program, 0, 'a_pos');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link error');
    const u = Object.fromEntries(uniforms.map((name) => [name, gl.getUniformLocation(program, name)])) as Program<U>['u'];
    return { program, u };
  }
}

let shared: GpuRenderer | null | undefined;

/** The app-wide renderer (created on first use), or null without WebGL2. */
export function getGpu(): GpuRenderer | null {
  if (shared === undefined) shared = GpuRenderer.create();
  return shared;
}
