'use client';

import { Renderer, Program, Mesh, Color, Triangle } from 'ogl';
import { useEffect, useRef } from 'react';
import './aurora.css';

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;

uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStops[3];
uniform vec2 uResolution;
uniform float uBlend;

out vec4 fragColor;

vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v){
  const vec4 C = vec4(
      0.211324865405187, 0.366025403784439,
      -0.577350269189626, 0.024390243902439
  );
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);

  vec3 p = permute(
      permute(i.y + vec3(0.0, i1.y, 1.0))
    + i.x + vec3(0.0, i1.x, 1.0)
  );

  vec3 m = max(
      0.5 - vec3(
          dot(x0, x0),
          dot(x12.xy, x12.xy),
          dot(x12.zw, x12.zw)
      ),
      0.0
  );
  m = m * m;
  m = m * m;

  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);

  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

struct ColorStop {
  vec3 color;
  float position;
};

#define COLOR_RAMP(colors, factor, finalColor) {              \
  int index = 0;                                            \
  for (int i = 0; i < 2; i++) {                               \
     ColorStop currentColor = colors[i];                    \
     bool isInBetween = currentColor.position <= factor;    \
     index = int(mix(float(index), float(i), float(isInBetween))); \
  }                                                         \
  ColorStop currentColor = colors[index];                   \
  ColorStop nextColor = colors[index + 1];                  \
  float range = nextColor.position - currentColor.position; \
  float lerpFactor = (factor - currentColor.position) / range; \
  finalColor = mix(currentColor.color, nextColor.color, lerpFactor); \
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  ColorStop colors[3];
  colors[0] = ColorStop(uColorStops[0], 0.0);
  colors[1] = ColorStop(uColorStops[1], 0.5);
  colors[2] = ColorStop(uColorStops[2], 1.0);

  vec3 rampColor;
  COLOR_RAMP(colors, uv.x, rampColor);

  /*
   * In WebGL, gl_FragCoord.y = 0 at the BOTTOM of the canvas.
   * We want the aurora brightest at y=0 (bottom) → use (1.0 - uv.y).
   * The snoise term makes the top edge of the glow wavy.
   */
  float wave = snoise(vec2(uv.x * 2.0 + uTime * 0.1, uTime * 0.25)) * 0.5 * uAmplitude;
  wave = exp(wave);
  /* flip: bottom = high value, top = low/negative */
  float height = (1.0 - uv.y) * 2.0 - wave + 0.2;
  float intensity = 0.6 * height;

  float midPoint = 0.20;
  float auroraAlpha = smoothstep(midPoint - uBlend * 0.5, midPoint + uBlend * 0.5, intensity);

  vec3 auroraColor = intensity * rampColor;

  fragColor = vec4(auroraColor * auroraAlpha, auroraAlpha);
}
`;

interface AuroraProps {
  colorStops?: string[];
  amplitude?: number;
  blend?: number;
  speed?: number;
  time?: number;
}

export function Aurora({
  colorStops = ['#00ff88', '#34b857', '#2dd4bf'],
  amplitude = 1.0,
  blend = 0.5,
  speed = 1.0,
  time,
}: AuroraProps) {
  const propsRef = useRef({ colorStops, amplitude, blend, speed, time });
  propsRef.current = { colorStops, amplitude, blend, speed, time };

  const ctnDom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctn = ctnDom.current;
    if (!ctn) return;

    const renderer = new Renderer({
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
    });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // Stretch canvas to fill its parent container
    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.backgroundColor = 'transparent';

    const padStops = (stops: string[]) => {
      const filled = [...stops];
      while (filled.length < 3) filled.push(filled[filled.length - 1] ?? '#000000');
      return filled.slice(0, 3);
    };

    let program: Program;

    const setSize = (w: number, h: number) => {
      renderer.setSize(w, h);
      if (program) program.uniforms.uResolution.value = [w, h];
    };

    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        if (width > 0 && height > 0) setSize(width, height);
      }
    });
    ro.observe(ctn);

    const geometry = new Triangle(gl);
    // Remove uv attribute if it exists
    if ((geometry.attributes as Record<string, unknown>).uv) {
      delete (geometry.attributes as Record<string, unknown>).uv;
    }

    const colorStopsArray = padStops(colorStops).map((hex) => {
      const c = new Color(hex);
      return [c.r, c.g, c.b];
    });

    program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: amplitude },
        uColorStops: { value: colorStopsArray },
        uResolution: { value: [ctn.offsetWidth || 1, ctn.offsetHeight || 1] },
        uBlend: { value: blend },
      },
    });

    const mesh = new Mesh(gl, { geometry, program });
    ctn.appendChild(canvas);

    // Initial size
    const w = ctn.offsetWidth;
    const h = ctn.offsetHeight;
    if (w > 0 && h > 0) setSize(w, h);

    let animateId = 0;
    const update = (t: number) => {
      animateId = requestAnimationFrame(update);
      const {
        time: customTime,
        speed: s = 1.0,
        colorStops: stops = colorStops,
      } = propsRef.current;
      const elapsed = customTime !== undefined ? customTime : t * 0.01;
      program.uniforms.uTime.value = elapsed * s * 0.1;
      program.uniforms.uAmplitude.value = propsRef.current.amplitude ?? 1.0;
      program.uniforms.uBlend.value = propsRef.current.blend ?? blend;
      program.uniforms.uColorStops.value = padStops(stops).map((hex) => {
        const c = new Color(hex);
        return [c.r, c.g, c.b];
      });
      renderer.render({ scene: mesh });
    };
    animateId = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(animateId);
      ro.disconnect();
      if (canvas.parentNode === ctn) ctn.removeChild(canvas);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={ctnDom} className="aurora-container" />;
}
