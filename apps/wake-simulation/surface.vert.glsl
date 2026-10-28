#version 300 es
in vec2 a_pos;
uniform float u_time;
uniform float u_amp;
uniform float u_freq;
uniform float u_speed;
uniform mat4 u_view;
uniform mat4 u_proj;
uniform float u_pointSize;

// wave array uniforms
const int MAX_WAVES = 16;
uniform int u_waveCount;
uniform vec2 u_waveOrigins[MAX_WAVES];
uniform float u_waveAmps[MAX_WAVES];
uniform float u_waveRadii[MAX_WAVES];
uniform float u_waveSigma;
uniform float u_waveDecay;

out float v_h;

void main(){
  vec2 p = a_pos;
  // base height starts at zero; ring waves will add to h
  float h = 0.0;

  // add ring waves
  for(int i=0;i<MAX_WAVES;i++){
    if(i >= u_waveCount) break;
    vec2 o = u_waveOrigins[i];
    float amp = u_waveAmps[i];
    float radius = u_waveRadii[i];
    float d = distance(p, o);
    // ring as gaussian centered at radius
    float diff = d - radius;
    float ring = amp * exp(-u_waveDecay * d) * exp(- (diff*diff) / (2.0 * u_waveSigma * u_waveSigma));
    h += ring;
  }

  v_h = h;
  vec4 pos = vec4(p.x, h, p.y, 1.0);
  gl_Position = u_proj * u_view * pos;
  gl_PointSize = max(1.0, u_pointSize);
}
