var Template = {
  render() {
    return "".concat(this.css(), "\n            ").concat(this.html());
  },

  map(scope) {
    return {
      canvas: scope.querySelector('canvas')
    };
  },

  html(node) {
    return "<canvas></canvas>";
  },

  css() {
    return "<style>\n      :host {\n        position: relative;\n        display: inline-block;\n        width: 250px;\n        height: 250px;\n      }\n      :host > canvas {\n        position: absolute;\n        top: 0;\n        left: 0;\n        height: 100%;\n        width: 100%;\n        border-radius: inherit;\n       }\n    </style>";
  }

};

function AudioContextResume(wa) {
  const dragged = new Set();
  const elements = new Set();
  const cbList = [];

  function onStart(cb) {
    if (wa.state === 'running') {
      console.log('already');
      cb();
    } else {
      cbList.push(cb);
    }
  }

  function handleDrag(e) {
    console.log(e);
    dragged.add(e.targetElement);
  }

  function handleTap(e) {
    if (!dragged.has(e.targetElement)) {
      start();
    } else {
      dragged.delete(e.targetElement);
    }
  }

  function handleStart() {
    cbList.forEach(cb => {
      cb();
    });
  }

  function start() {
    // ios shenanigans
    const s = wa.createBufferSource();
    s.buffer = wa.createBuffer(1, 1, wa.sampleRate);
    s.connect(wa.destination);
    s.start(0); // resume

    if (typeof wa.resume === 'function') {
      wa.resume().then(handleStart);
    }

    dispose();
  }

  function register(el) {
    el.addEventListener('touchstart', handleTap);
    el.addEventListener('touchmove', handleDrag);
    el.addEventListener('touchend', handleTap);
    el.addEventListener('mouseup', handleTap);
    elements.add(el);
  }

  function dispose() {
    elements.forEach(el => {
      el.removeEventListener('touchstart', handleTap);
      el.removeEventListener('touchmove', handleDrag);
      el.removeEventListener('touchend', handleTap);
      el.removeEventListener('mouseup', handleTap);
    });
    elements.clear();
    dragged.clear();
  }

  return {
    onStart,
    register,
    dispose
  };
}

const TIME = 0;
const DELTA = 1;
const DATE = 2;
const FRAME = 3;
const GLOBAL_UNIFORMS = [{
  name: 'u_time',
  toyname: 'iTime',
  type: 'float',
  value: 0
}, {
  name: 'u_delta',
  toyname: 'iTimeDelta',
  type: 'float',
  value: 0
}, {
  name: 'u_date',
  toyname: 'iDate',
  type: 'vec4',
  value: [0, 0, 0, 0]
}, {
  name: 'u_frame',
  toyname: 'iFrame',
  type: 'int',
  value: 0
}];
const RESOLUTION = 0;
const MOUSE = 1;
const MOUSEDRAG = 2;
const SURFACE_UNIFORMS = [{
  name: 'u_resolution',
  toyname: 'iResolution',
  type: 'vec2',
  value: [0, 0]
}, {
  name: 'u_mouse',
  toyname: 'iCurrentMouse',
  type: 'vec2',
  value: [0, 0]
}, {
  name: 'u_mousedrag',
  toyname: 'iMouse',
  type: 'vec4',
  value: [0, 0, 0, 0]
}];
const ORIENTATION = 0;
const ORIENTATION_UNIFORMS = [{
  name: 'u_orientation',
  toyname: 'iOrientation',
  type: 'vec3',
  value: [0, 0, 0]
}];
const BASE_UNIFORM_ARRAY = [...GLOBAL_UNIFORMS, ...ORIENTATION_UNIFORMS, ...SURFACE_UNIFORMS];
const SHADERTOY_IO = /\(\s*out\s+vec4\s+(\S+)\s*,\s*in\s+vec2\s+(\S+)\s*\)/;

var cheapClone = (obj => JSON.parse(JSON.stringify(obj)));

function DeviceOrientation() {
  let orientationRequested = false;
  const ustate = cheapClone(ORIENTATION_UNIFORMS);

  function setup() {
    if (orientationRequested) return;
    orientationRequested = true;

    if (typeof DeviceOrientationEvent === 'object' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then(perms => {
        if (perms === 'granted') {
          window.addEventListener('deviceorientation', handleDeviceOrientation);
        }
      }).catch(console.error);
    } else {
      window.addEventListener('deviceorientation', handleDeviceOrientation);
    }
  }

  function handleDeviceOrientation(e) {
    ustate[ORIENTATION].value[0] = e.alpha;
    ustate[ORIENTATION].value[1] = e.beta;
    ustate[ORIENTATION].value[2] = e.gamma;
  }

  function dispose() {
    window.removeEventListener('deviceorientation', handleDeviceOrientation);
  }

  return {
    get ustate() {
      return ustate;
    },

    setup,
    dispose
  };
}

function Extensions(gl) {
  const extensions = {};
  const getter = gl.getExtension.bind(gl);
  return {
    get: function get(name) {
      if (extensions[name] !== undefined) return extensions[name];
      const extension = getter(name) || getter("MOZ_".concat(name)) || getter("WEBKIT_".concat(name));

      if (extension === null) {
        console.warn("<shader-doodle /> ".concat(name, " extension not supported."));
      }

      extensions[name] = extension;
      return extension;
    }
  };
}

function Renderer() {
  const canvas = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  const deviceorientation = DeviceOrientation();
  const wa = new (window.AudioContext || window.webkitAudioContext)();
  const audioCtxResume = new AudioContextResume(wa);
  wa.onStart = audioCtxResume.onStart;
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let animationFrame;
  let lastTime;
  const surfaces = new Set();
  const ustate = cheapClone(GLOBAL_UNIFORMS);
  const extensions = Extensions(gl);
  extensions.get('OES_texture_float');
  extensions.get('OES_texture_float_linear');
  extensions.get('OES_texture_half_float');
  extensions.get('OES_texture_half_float_linear');

  function setSize(w, h) {
    if (w !== width) {
      width = w;
      canvas.width = Math.floor(width * pixelRatio);
    }

    if (h !== height) {
      height = h;
      canvas.height = Math.floor(height * pixelRatio);
    }
  }

  function updateSize(w, h) {
    if (w > width || h > height) {
      setSize(Math.max(w, width), Math.max(h, height));
    }
  }

  function updateTimeState(timestamp) {
    const delta = lastTime ? (timestamp - lastTime) / 1000 : 0;
    lastTime = timestamp;
    ustate[TIME].value += delta;
    ustate[DELTA].value = delta;
    ustate[FRAME].value++;
    const d = new Date();
    ustate[DATE].value[0] = d.getFullYear();
    ustate[DATE].value[1] = d.getMonth() + 1;
    ustate[DATE].value[2] = d.getDate();
    ustate[DATE].value[3] = d.getHours() * 60 * 60 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() * 0.001;
  }

  function render(timestamp) {
    if (!surfaces.size) {
      return;
    } // TODO: handle pixelRatio?
    // const dpr = getDpr();
    // if (dpr !== getPixelRatio()) {
    //   setPixelRatio(dpr);
    // }


    updateTimeState(timestamp);
    const u = [...ustate, ...deviceorientation.ustate];
    surfaces.forEach(surface => surface.render(canvas, updateSize, width, height, pixelRatio, u));
    animationFrame = requestAnimationFrame(render);
  }

  function addSurface(surface) {
    audioCtxResume.register(surface.dom);
    surface.addClick(deviceorientation.setup);
    surfaces.add(surface);

    if (!animationFrame) {
      animationFrame = requestAnimationFrame(render);
    }
  }

  function removeSurface(surface) {
    surfaces.delete(surface);
  }

  function dispose() {
    surfaces.forEach(s => s.dispose());
    surfaces.clear();
    surfaces = undefined;
    cancelAnimationFrame(animationFrame);
    deviceorientation.dispose();
    audioCtxResume.dispose(); // TODO: any other cleanup??
  } // TODO: not sure if this is where i should actually handle clearColor()


  gl.clearColor(0, 0, 0, 0);
  return Object.freeze({
    get gl() {
      return gl;
    },

    get wa() {
      return wa;
    },

    addSurface,
    removeSurface,
    dispose
  });
}

let singletonRenderer;

Renderer.singleton = function () {
  if (!singletonRenderer) {
    singletonRenderer = Renderer();
  }

  return singletonRenderer;
};

Renderer.resetSingleton = function () {
  if (singletonRenderer) singletonRenderer.dispose();
  singletonRenderer = Renderer();
};

class SDBaseElement extends HTMLElement {
  get renderer() {
    return Renderer.singleton();
  }

  get name() {
    return this.getAttribute('name');
  }

  set name(val) {
    this.setAttribute('name', val);
  }

}

function Attributes(gl, program) {
  const attributes = {};
  const n = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);

  for (let i = 0; i < n; i++) {
    const {
      name
    } = gl.getActiveAttrib(program, i);
    attributes[name] = gl.getAttribLocation(program, name);
  }

  return attributes;
}

function Framebuffer(gl) {
  let width;
  let height;
  const handle = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, handle);
  const texture = gl.createTexture();
  if (!texture) throw new Error('createTexture returned null');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  updateTexture(true);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

  function bind() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, handle);
    gl.viewport(0, 0, width, height);
  } // TODO... tempfix??? something better here


  function updateTexture(init) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, init ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, init ? gl.NEAREST : gl.LINEAR);
  }

  function updateResolution(w, h) {
    if (w !== width || h !== height) {
      width = w;
      height = h;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.FLOAT, null);
    }
  }

  function dispose() {
    gl.deleteFramebuffer(handle);
    gl.deleteTexture(texture);
  }

  return {
    get handle() {
      return handle;
    },

    get texture() {
      return texture;
    },

    updateTexture,
    bind,
    updateResolution,
    dispose
  };
}

function Shader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader); // log shader errors

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const compilationLog = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    console.warn(compilationLog, '\nin shader:\n', source);
  }

  return shader;
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;

  for (let i = 0, l = a.length; i < l; i++) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

function copyArray(a, b) {
  for (let i = 0, l = b.length; i < l; i++) {
    a[i] = b[i];
  }
}

function setValueV1f(cache, location, gl, v) {
  if (cache[0] === v) return;
  gl.uniform1f(location, v);
  cache[0] = v;
}

function setValueV2f(cache, location, gl, v) {
  if (arraysEqual(cache, v)) return;
  gl.uniform2fv(location, v);
  copyArray(cache, v);
}

function setValueV3f(cache, location, gl, v) {
  if (arraysEqual(cache, v)) return;
  gl.uniform3fv(location, v);
  copyArray(cache, v);
}

function setValueV4f(cache, location, gl, v) {
  if (arraysEqual(cache, v)) return;
  gl.uniform4fv(location, v);
  copyArray(cache, v);
}

function setValueT1(cache, location, gl, v) {
  if (cache[0] !== v) {
    gl.uniform1i(location, v);
    cache[0] = v;
  }
}

function getUniformSetter(type) {
  switch (type) {
    case 0x1406:
      // FLOAT
      return setValueV1f;

    case 0x8b50:
      // FLOAT_VEC2
      return setValueV2f;

    case 0x8b51:
      // FLOAT_VEC3
      return setValueV3f;

    case 0x8b52:
      // FLOAT_VEC4
      return setValueV4f;

    case 0x8b5e: // SAMPLER_2D

    case 0x8d66:
      // SAMPLER_EXTERNAL_OES
      return setValueT1;
  }
}

function Uniform(gl, info, location) {
  const cache = [];
  const setter = getUniformSetter(info.type);

  function setValue() {
    for (var _len = arguments.length, params = new Array(_len), _key = 0; _key < _len; _key++) {
      params[_key] = arguments[_key];
    }

    setter(cache, location, gl, ...params);
  }

  return {
    get location() {
      return location;
    },

    get name() {
      return info.name;
    },

    setValue
  };
}

function Uniforms(gl, program) {
  const uniforms = {};
  const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);

  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(program, i);
    const location = gl.getUniformLocation(program, info.name);
    const u = Uniform(gl, info, location);
    uniforms[u.name] = u;
  }

  return uniforms;
}

var resolveToy = ((uniform, toy, prop) => {
  if (!toy) return uniform[prop];
  const toyprop = "toy".concat(prop);

  if (uniform.hasOwnProperty(toyprop)) {
    return uniform[toyprop];
  }

  return uniform[prop];
});

var createUniformString = ((uniforms, toy) => Object.values(uniforms).reduce((acc, u) => acc + "uniform ".concat(resolveToy(u, toy, 'type'), " ").concat(resolveToy(u, toy, 'name'), ";\n"), ''));

let currentProgramId = 0;

function prepareFragShader(fs, shadertoy) {
  // format/replace special shadertoy io
  if (shadertoy) {
    const io = fs.match(SHADERTOY_IO);
    fs = fs.replace('mainImage', 'main');
    fs = fs.replace(SHADERTOY_IO, '()');
    fs = (io ? "#define ".concat(io[1], " gl_FragColor\n#define ").concat(io[2], " gl_FragCoord.xy\n") : '') + fs;
  } // prepend fs string with uniforms and precision


  fs = createUniformString(BASE_UNIFORM_ARRAY, shadertoy) + fs;
  fs = 'precision highp float;\n' + fs;
  return fs;
}

function Program(gl, vs, fs, vertices) {
  let shadertoy = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : false;
  const id = currentProgramId++;
  const program = gl.createProgram();
  const vertexBuffer = gl.createBuffer();
  const vertexShader = Shader(gl, gl.VERTEX_SHADER, vs);
  const fragmentShader = Shader(gl, gl.FRAGMENT_SHADER, prepareFragShader(fs, shadertoy));
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  let name;
  let unit;
  let framebuffer;
  let prevbuffer;
  let prevbufferUnit;
  const attributes = Attributes(gl, program);
  const uniforms = Uniforms(gl, program);
  const nodes = new Set();
  const textures = new Set();
  let textureUnit = 0; // log program errors

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const linkLog = gl.getProgramInfoLog(program);
    console.warn(linkLog);
  } // cleanup


  gl.detachShader(program, vertexShader);
  gl.detachShader(program, fragmentShader);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader); // TODO: where/when to better handle vertices

  const verticesLocation = attributes.position;
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(verticesLocation);
  gl.vertexAttribPointer(verticesLocation, 2, gl.FLOAT, false, 0, 0);

  function addNode(node, name, usePrev) {
    node.toFbo(name, getTexUnit(), usePrev);
    nodes.add(node);
  }

  function removeNode(node) {
    nodes.delete(node);
  }

  function addTexture(texture) {
    textures.add(texture);
  }

  function removeTexture(texture) {
    textures.delete(texture);
  }

  function getTexUnit() {
    return textureUnit++;
  }

  function toFbo(nameParam, unitParam, usePrev) {
    name = nameParam;
    unit = unitParam;
    framebuffer = Framebuffer(gl);

    if (usePrev) {
      prevbuffer = Framebuffer(gl);
      prevbufferUnit = getTexUnit();
    }
  }

  function updateSingleUniform(state) {
    const u = uniforms[resolveToy(state, shadertoy, 'name')];

    if (u) {
      u.setValue(resolveToy(state, shadertoy, 'value'));
    }
  }

  function update(ustateArray) {
    // TODO: update is bad... i'd rather just reuse tex units from here
    // instead of assigning them out to textures/buffers at init time
    // global/surface uniforms
    ustateArray.forEach(updateSingleUniform); // textures

    textures.forEach(texture => texture.update(updateSingleUniform)); // swapbuffer

    if (prevbuffer && uniforms.u_prevbuffer) {
      const u = uniforms.u_prevbuffer;

      if (u) {
        u.setValue(prevbufferUnit);
        gl.activeTexture(gl["TEXTURE".concat(prevbufferUnit)]);
        gl.bindTexture(gl.TEXTURE_2D, prevbuffer.texture); // TODO... tempfix???

        prevbuffer.updateTexture();
      }
    }

    nodes.forEach(node => {
      uniforms[node.name].setValue(node.u);
      gl.activeTexture(gl["TEXTURE".concat(node.u)]);
      gl.bindTexture(gl.TEXTURE_2D, node.fbo.texture); // TODO... tempfix???

      node.fbo.updateTexture();
    });
  }

  function render(w, h, ustateArray) {
    if (nodes.size) {
      nodes.forEach(node => node.render(w, h, ustateArray));
    }

    if (framebuffer) {
      if (prevbuffer) {
        const swap = framebuffer;
        framebuffer = prevbuffer;
        prevbuffer = swap;
        prevbuffer.bind();
        prevbuffer.updateResolution(w, h);
      }

      framebuffer.updateResolution(w, h);
      framebuffer.bind();
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
    }

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    update(ustateArray);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function dispose() {
    textures.forEach(t => {
      if (typeof t.dispose === 'function') t.dispose();
    });
    textures.clear();
    gl.deleteProgram(program);
  }

  return {
    get id() {
      return id;
    },

    get nodes() {
      return nodes;
    },

    get fbo() {
      return framebuffer;
    },

    get name() {
      return name;
    },

    get u() {
      return unit;
    },

    render,
    addNode,
    removeNode,
    addTexture,
    removeTexture,
    getTexUnit,
    update,
    toFbo,
    dispose
  };
}

var asyncLoadTextFromUrl = (url => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url);

  xhr.onreadystatechange = () => {
    if (xhr.readyState === XMLHttpRequest.DONE) {
      if (xhr.status === 200) {
        resolve(xhr.responseText);
      } else {
        reject(xhr.status);
      }
    }
  };

  xhr.send();
}));

var asyncGetScriptContent = (async script => {
  if (script.src) {
    return asyncLoadTextFromUrl(script.src);
  }

  return script.text;
});

const DEFAULT_VS = "attribute vec2 position;\nvoid main() {\n  gl_Position = vec4(position, 0.0, 1.0);\n}"; // prettier-ignore

const DEFAULT_VERTICES = new Float32Array([-1, 1, 1, 1, 1, -1, -1, 1, 1, -1, -1, -1]);
const UNNAMED_NODE_PREFIX = 'u_node';
let unnamedNodeIndex = 0;

class SDNodeElement extends SDBaseElement {
  disconnectedCallback() {
    this.program.dispose();
    this.program = undefined;
  }

  get shadertoy() {
    return this.hasAttribute('shadertoy');
  }

  set shadertoy(s) {
    if (s) {
      this.setAttribute('shadertoy', '');
    } else {
      this.removeAttribute('shadertoy');
    }
  }

  get prevbuffer() {
    return this.hasAttribute('prevbuffer');
  }

  set prevbuffer(s) {
    if (s) {
      this.setAttribute('prevbuffer', '');
    } else {
      this.removeAttribute('prevbuffer');
    }
  }

  get vertices() {
    let v = this.getAttribute('vertices');

    if (!v) {
      return DEFAULT_VERTICES;
    }

    v = JSON.parse(v);

    if (!Array.isArray(v)) {
      return DEFAULT_VERTICES;
    }

    return new Float32Array(v);
  }

  set vertices(v) {
    if (!v || !Array.isArray(v)) {
      return;
    }

    this.setAttribute('vertices', JSON.stringify(v));
  }

  get forcedHeight() {
    let h = this.getAttribute('data-forced-height');
    if (!h) return -1;
    return parseInt(h);
  }

  set forcedHeight(h) {
    let height = parseInt(h);
    if (!h || !Number.isInteger(height)) return;
    this.setAttribute('data-forced-height', h);
  }

  get forcedWidth() {
    let h = this.getAttribute('data-forced-width');
    if (!h) return -1;
    return parseInt(h);
  }

  set forcedWidth(h) {
    let width = parseInt(h);
    if (!h || !Number.isInteger(width)) return;
    this.setAttribute('data-forced-width', h);
  }

  async init(parentProgram) {
    if (parentProgram && !this.name) {
      this.name = "".concat(UNNAMED_NODE_PREFIX).concat(unnamedNodeIndex++);
    }

    const elems = [];
    let vs;
    let fs;

    for (let i = 0; i < this.children.length; i++) {
      const c = this.children[i];

      if (c instanceof SDBaseElement) {
        elems.push(c);
      } else {
        switch (c.getAttribute('type')) {
          case 'x-shader/x-fragment':
            fs = await asyncGetScriptContent(c);
            break;

          case 'x-shader/x-vertex':
            vs = await asyncGetScriptContent(c);
            break;
        }
      }
    }

    vs = vs || DEFAULT_VS;
    this.program = Program(this.renderer.gl, vs, fs, this.vertices, this.shadertoy);
    elems.forEach(e => {
      e.init(this.program);
    });

    if (parentProgram) {
      parentProgram.addNode(this.program, this.name, this.prevbuffer);
    }
  }

}

if (!customElements.get('sd-node')) {
  customElements.define('sd-node', SDNodeElement);
}

const PIXEL = new Uint8Array([0, 0, 0, 255]);

const isPow2 = value => !(value & value - 1) && !!value;

const floorPowerOfTwo = value => 2 ** Math.floor(Math.log(value) / Math.LN2);

function Texture(gl, textureUnit) {
  let optsParam = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
  const TEXTURE_2D = gl.TEXTURE_2D;
  const textureObject = gl.createTexture();
  const options = {};
  const parameters = [];
  let px;
  let pow2canvas;

  function activate() {
    if (gl.getParameter(gl.ACTIVE_TEXTURE) === textureUnit) return;
    gl.activeTexture(gl["TEXTURE".concat(textureUnit)]);
  }

  function bind() {
    activate();
    gl.bindTexture(TEXTURE_2D, textureObject);
  }

  function checkPow2() {
    const {
      pixels
    } = options;
    const wrapS = gl.getTexParameter(TEXTURE_2D, gl.TEXTURE_WRAP_S);
    const wrapT = gl.getTexParameter(TEXTURE_2D, gl.TEXTURE_WRAP_T);
    const minFilter = gl.getTexParameter(TEXTURE_2D, gl.TEXTURE_MIN_FILTER);
    const isPowerOf2 = isPow2(pixels.width) && isPow2(pixels.height);
    const needsPowerOfTwo = wrapS !== gl.CLAMP_TO_EDGE || wrapT !== gl.CLAMP_TO_EDGE || minFilter !== gl.LINEAR && minFilter !== gl.NEAREST;

    if (needsPowerOfTwo && !isPowerOf2) {
      if (!pow2canvas) {
        pow2canvas = document.createElement('canvas');
        pow2canvas.width = floorPowerOfTwo(pixels.width);
        pow2canvas.height = floorPowerOfTwo(pixels.height);
        console.warn("Texture is not power of two ".concat(pixels.width, " x ").concat(pixels.height, ". Resized to ").concat(pow2canvas.width, " x ").concat(pow2canvas.height, ";"));
      }

      const ctx = pow2canvas.getContext('2d');
      ctx.drawImage(pixels, 0, 0, pow2canvas.width, pow2canvas.height);
    }

    px = pow2canvas || pixels;
  }

  function setParameters(params) {
    activate();
    parameters.length = 0;
    params.forEach(p => {
      parameters.push(p);
      gl.texParameteri(TEXTURE_2D, p[0], p[1]);
    });
  }

  function updateParameters() {
    parameters.forEach(p => {
      gl.texParameteri(TEXTURE_2D, p[0], p[1]);
    });
  }

  function shallow() {
    bind();
    updateParameters();
  }

  function update(opts) {
    if (typeof opts !== 'object') return;
    Object.assign(options, opts);
    bind();
    const {
      level,
      internalFormat,
      offsetX,
      offsetY,
      width,
      height,
      border,
      format,
      type,
      flipY,
      buffer,
      pixels
    } = options;
    updateParameters();
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);

    if (pixels) {
      if (pixels.width === 0 || pixels.height === 0) {
        console.warn("Texture size is invalid ".concat(pixels.width, " x ").concat(pixels.height, ". Update is skipped;"));
        return;
      }

      checkPow2();
    }

    if (typeof offsetX === 'number' && typeof offsetY === 'number') {
      if (px) {
        gl.texSubImage2D(TEXTURE_2D, level, offsetX, offsetY, format, type, px);
      } else {
        gl.texSubImage2D(TEXTURE_2D, level, offsetX, offsetY, width, height, format, type, buffer);
      }
    } else {
      if (px) {
        gl.texImage2D(TEXTURE_2D, level, internalFormat, format, type, px);
      } else {
        gl.texImage2D(TEXTURE_2D, level, internalFormat, width, height, border, format, type, buffer);
      }
    }

    if (px && isPow2(px.width) && isPow2(px.height)) {
      const minFilter = gl.getTexParameter(TEXTURE_2D, gl.TEXTURE_MIN_FILTER);

      if (minFilter !== gl.LINEAR && minFilter !== gl.NEAREST) {
        gl.generateMipmap(TEXTURE_2D);
      }
    }
  }

  function dispose() {
    gl.deleteTexture(textureObject);
  }

  update(Object.assign({
    level: 0,
    internalFormat: gl.RGBA,
    offsetX: null,
    offsetY: null,
    width: 1,
    height: 1,
    border: 0,
    format: gl.RGBA,
    type: gl.UNSIGNED_BYTE,
    flipY: true,
    buffer: PIXEL,
    pixels: null
  }, typeof optsParam === 'object' ? optsParam : {}));
  return {
    setParameters,
    shallow,
    update,
    dispose
  };
}

function asyncFetchAudioBuffer(url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';

    xhr.onreadystatechange = () => {
      if (xhr.readyState === XMLHttpRequest.DONE) {
        if (xhr.status === 200 || xhr.status === 206) {
          resolve(xhr.response);
        } else {
          console.log(xhr);
          reject(xhr.status);
        }
      }
    };

    xhr.send();
  });
}

function asyncDecodeAudioBuffer(buf, wa) {
  return new Promise((resolve, reject) => {
    wa.decodeAudioData(buf, resolve, reject);
  });
}

function AudioTexture(renderer, textureUnit, name, src, mic, loop, autoplay, crossOrigin) {
  const gl = renderer.gl;
  const wa = renderer.wa;
  const analyzer = wa.createAnalyser();
  analyzer.fftSize = 1024;
  const freqData = new Uint8Array(analyzer.frequencyBinCount);
  const waveData = new Uint8Array(analyzer.frequencyBinCount);
  const texture = Texture(gl, textureUnit, {
    internalFormat: gl.LUMINANCE,
    width: waveData.length,
    height: 2,
    format: gl.LUMINANCE,
    buffer: null
  });
  texture.setParameters([[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.NEAREST]]);
  let element;
  let source;
  let isFile = false;
  const ustate = [{
    name,
    value: textureUnit
  }];
  /* TODO: maybe re-instate when the ios13 issue has answers
  function setupAudioFile() {
    element = new Audio();
    element.loop = loop;
    element.autoplay = autoplay;
    element.crossOrigin = crossOrigin;
    element.src = src;
    source = wa.createMediaElementSource(element);
    element.load();
     if (autoplay) {
      wa.onStart(() => element.play());
    }
  } */

  /* i don't like it but its the only way to get this working in ios13 */

  async function setupAudioFile() {
    source = wa.createBufferSource();
    source.buffer = await asyncDecodeAudioBuffer((await asyncFetchAudioBuffer(src)), wa);
    source.loop = loop;
    source.start();
    isFile = true;
  }

  function setupAudioElement() {
    const audioElement = document.querySelector(src);

    if (audioElement && audioElement instanceof HTMLAudioElement) {
      element = audioElement;
      source = wa.createMediaElementSource(audioElement);
    }
  }

  function analyze(source, destination) {
    source.connect(analyzer);
    analyzer.connect(destination);
  }

  function shouldUpdate() {
    return isFile || element && element.readyState > 2 && !element.paused && !element.ended && element.currentTime;
  }

  function update(updateSingleUniform) {
    ustate.forEach(updateSingleUniform);

    if (shouldUpdate()) {
      analyzer.getByteFrequencyData(freqData);
      analyzer.getByteTimeDomainData(waveData);
      texture.update({
        offsetX: 0,
        offsetY: 0,
        height: 1,
        buffer: freqData
      });
      texture.update({
        offsetX: 0,
        offsetY: 1,
        height: 1,
        buffer: waveData
      });
    }
  } // TODO: mic support

  /* if (mic) {
    setupMic();
  } else */


  if (src[0] === '#') {
    setupAudioElement();
  } else if (src) {
    setupAudioFile();
  }

  if (source) {
    analyze(source, wa.destination);
  }

  return {
    update
  };
}

const UNNAMED_AUDIO_PREFIX = 'u_audio';
let unnamedAudioIndex = 0;

class SDAudioElement extends SDBaseElement {
  disconnectedCallback() {
    this.program.removeTexture(this.texture);
    this.texture.dispose();
  }

  get src() {
    return this.getAttribute('src');
  }

  set src(val) {
    this.setAttribute('src', val);
  }

  get autoplay() {
    return this.hasAttribute('autoplay');
  }

  set autoplay(a) {
    if (a) {
      this.setAttribute('autoplay', '');
    } else {
      this.removeAttribute('autoplay');
    }
  }

  get loop() {
    return this.hasAttribute('loop');
  }

  set loop(l) {
    if (l) {
      this.setAttribute('loop', '');
    } else {
      this.removeAttribute('loop');
    }
  }

  get crossOrigin() {
    return this.getAttribute('crossorigin');
  }

  set crossOrigin(c) {
    this.setAttribute('crossorigin', c);
  }

  get mic() {
    return this.hasAttribute('mic');
  }

  set mic(m) {
    if (m) {
      this.setAttribute('mic', '');
    } else {
      this.removeAttribute('mic');
    }
  }

  init(program) {
    if (!this.name) {
      this.name = "".concat(UNNAMED_AUDIO_PREFIX).concat(unnamedAudioIndex++);
    }

    if (!this.src) return;
    this.program = program;
    this.texture = AudioTexture(this.renderer, program.getTexUnit(), this.name, this.src, this.mic, this.loop, this.autoplay, this.crossOrigin);
    program.addTexture(this.texture);
  }

}

if (!customElements.get('sd-audio')) {
  customElements.define('sd-audio', SDAudioElement);
}

function _defineProperty(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  } else {
    obj[key] = value;
  }

  return obj;
}

function ownKeys(object, enumerableOnly) {
  var keys = Object.keys(object);

  if (Object.getOwnPropertySymbols) {
    var symbols = Object.getOwnPropertySymbols(object);
    if (enumerableOnly) symbols = symbols.filter(function (sym) {
      return Object.getOwnPropertyDescriptor(object, sym).enumerable;
    });
    keys.push.apply(keys, symbols);
  }

  return keys;
}

function _objectSpread2(target) {
  for (var i = 1; i < arguments.length; i++) {
    var source = arguments[i] != null ? arguments[i] : {};

    if (i % 2) {
      ownKeys(source, true).forEach(function (key) {
        _defineProperty(target, key, source[key]);
      });
    } else if (Object.getOwnPropertyDescriptors) {
      Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
    } else {
      ownKeys(source).forEach(function (key) {
        Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
      });
    }
  }

  return target;
}

const IMAGE = 0;
const VIDEO = 1;
const CAMERA = 2;
const CANVAS = 3;
const IMG_REG = /\w+\.(jpg|jpeg|png|gif|bmp)(?=\?|$)/i;

const isImage = s => IMG_REG.test(s);

const VID_REG = /\w+\.(mp4|3gp|webm|ogv)(?=\?|$)/i;

const isVideo = s => VID_REG.test(s);

function addHiddenInDOM(video) {
  const wrapper = document.createElement('div');
  wrapper.style.width = wrapper.style.height = '1px';
  wrapper.style.overflow = 'hidden';
  wrapper.style.position = 'absolute';
  wrapper.style.opacity = '0';
  wrapper.style.pointerEvents = 'none';
  wrapper.style.zIndex = '-1000';
  wrapper.appendChild(video);
  document.body.appendChild(wrapper);
}

function GeneralTexture(renderer, textureUnit, name, src, webcam, wrapS, wrapT, minFilter, magFilter, forceUpdate) {
  const gl = renderer.gl;
  const texture = Texture(gl, textureUnit);
  let source;
  let type;
  const ustate = [{
    name,
    value: textureUnit
  }, {
    name: name + '_resolution',
    value: [0, 0]
  }];

  function setupElementReference() {
    try {
      source = document.querySelector(src);
    } catch (e) {
      console.warn("src: ".concat(src, ": invalid selector"));
    }

    if (!source) {
      console.warn("src: ".concat(src, ": no element could be selected"));
      return;
    }

    if (source instanceof HTMLImageElement) {
      type = IMAGE;

      if (source.complete) {
        imageOnload();
      } else {
        source.addEventListener('load', imageOnload);
      }
    } else if (source instanceof HTMLVideoElement) {
      type = VIDEO;
      videoOnSetup();
    } else if (source instanceof HTMLCanvasElement) {
      type = CANVAS;
      imageOnload();
    } else {
      console.warn("src: ".concat(src, ": element is not a valid texture source"));
    }
  }

  function setupImage() {
    type = IMAGE;
    source = new Image();
    source.crossOrigin = 'anonymous';
    source.onload = imageOnload;

    source.onerror = () => {
      console.warn("failed loading src: ".concat(src));
    };

    source.src = src;
  }

  function imageOnload() {
    updateResolution();
    texture.setParameters([[gl.TEXTURE_WRAP_S, wrapS], [gl.TEXTURE_WRAP_T, wrapT], [gl.TEXTURE_MIN_FILTER, minFilter], [gl.TEXTURE_MAG_FILTER, magFilter]]);
    texture.update({
      pixels: source
    });
  }

  function setupVideo() {
    type = VIDEO;
    source = document.createElement('video');
    source.autoplay = true;
    source.muted = true;
    source.loop = true;
    source.playsInline = true;
    source.crossOrigin = 'anonymous';
    source.src = src;
    addHiddenInDOM(source);
    videoOnSetup();
    source.play();
  }

  function videoOnSetup() {
    updateResolution();
    texture.setParameters([[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.LINEAR]]);
  }

  function setupCamera() {
    type = CAMERA;
    const getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;

    const start = stream => {
      source = document.createElement('video');
      source.width = 320;
      source.height = 240;
      source.autoplay = true;
      source.srcObject = stream;
      addHiddenInDOM(source);
      videoOnSetup();
    };

    const initCam = () => {
      navigator.mediaDevices.getUserMedia({
        video: true
      }).then(start).catch(e => console.log(e.name + ': ' + e.message));
    };

    const initCamLegacy = () => {
      getUserMedia({
        video: true
      }, start, e => e);
    };

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      initCam();
    } else if (getUserMedia) {
      initCamLegacy();
    }
  }

  function updateResolution() {
    if (source) {
      ustate[1].value[0] = source.width;
      ustate[1].value[1] = source.height;
    }
  }

  function shouldUpdate() {
    return forceUpdate || (type === CAMERA || type === VIDEO) && source instanceof HTMLVideoElement && source.readyState === source.HAVE_ENOUGH_DATA;
  }

  function update(updateSingleUniform) {
    ustate.forEach(updateSingleUniform);

    if (shouldUpdate()) {
      texture.update({
        pixels: source
      });
    } else {
      texture.shallow();
    }
  } // init


  if (webcam) {
    setupCamera();
  } else if (isVideo(src)) {
    setupVideo();
  } else if (isImage(src)) {
    setupImage();
  } else {
    setupElementReference();
  }

  return {
    update
  };
}

const REPEAT = 0x2901;
const CLAMP_TO_EDGE = 0x812f;
const MIRRORED_REPEAT = 0x8370;
const NEAREST = 0x2600;
const LINEAR = 0x2601;
const NEAREST_MIPMAP_NEAREST = 0x2700;
const LINEAR_MIPMAP_NEAREST = 0x2701;
const NEAREST_MIPMAP_LINEAR = 0x2702;
const LINEAR_MIPMAP_LINEAR = 0x2703;
const MAG_OPTIONS = {
  NEAREST,
  LINEAR
};

const MIN_OPTIONS = _objectSpread2({}, MAG_OPTIONS, {
  NEAREST_MIPMAP_NEAREST,
  LINEAR_MIPMAP_NEAREST,
  NEAREST_MIPMAP_LINEAR,
  LINEAR_MIPMAP_LINEAR
});

const WRAP_OPTIONS = {
  REPEAT,
  MIRRORED_REPEAT,
  CLAMP_TO_EDGE
};
const UNNAMED_TEXTURE_PREFIX = 'u_texture';
let unnamedTextureIndex = 0;

class TextureElement extends SDBaseElement {
  static get observedAttributes() {
    return ['mag-filter', 'min-filter', 'name', 'src', 'wrap-s', 'wrap-t'];
  }

  disconnectedCallback() {
    this.program.removeTexture(this.texture); // Dispose doesn't seem to exist on this object. A TODO?

    if (typeof this.texture.dispose === 'function') this.texture.dispose();
  }

  get forceUpdate() {
    return this.hasAttribute('force-update');
  }

  set forceUpdate(f) {
    if (f) {
      this.setAttribute('force-update', '');
    } else {
      this.removeAttribute('force-update');
    }
  }

  get magFilter() {
    return MAG_OPTIONS[this.getAttribute('mag-filter')] || LINEAR;
  }

  get minFilter() {
    return MIN_OPTIONS[this.getAttribute('min-filter')] || LINEAR_MIPMAP_LINEAR;
  }

  get src() {
    return this.getAttribute('src');
  }

  set src(val) {
    this.setAttribute('src', val);
  }

  get webcam() {
    return this.hasAttribute('webcam');
  }

  set webcam(cam) {
    if (cam) {
      this.setAttribute('webcam', '');
    } else {
      this.removeAttribute('webcam');
    }
  }

  get wrapS() {
    return WRAP_OPTIONS[this.getAttribute('wrap-s')] || REPEAT;
  }

  get wrapT() {
    return WRAP_OPTIONS[this.getAttribute('wrap-t')] || REPEAT;
  }

  init(program) {
    if (!this.name) {
      this.name = "".concat(UNNAMED_TEXTURE_PREFIX).concat(unnamedTextureIndex++);
    }

    if (!this.src && !this.webcam) return;
    this.program = program;
    this.texture = GeneralTexture(this.renderer, program.getTexUnit(), this.name, this.src, this.webcam, this.wrapS, this.wrapT, this.minFilter, this.magFilter, this.forceUpdate);
    program.addTexture(this.texture);
  }

}

if (!customElements.get('sd-texture')) {
  customElements.define('sd-texture', TextureElement);
}

const TOUCH_EVENTS = new Set(['touchstart', 'touchmove', 'touchend']);

const mouseOrTouch = e => TOUCH_EVENTS.has(e.type) && typeof e.touches[0] === 'object' ? e.touches[0] : e;

var getMouseOrTouch = (e => {
  const a = mouseOrTouch(e);
  return [a.clientX || 0, a.clientY || 0];
});

function Surface(element, program, sdNode) {
  const canvas = element instanceof HTMLCanvasElement ? element : document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
  const ctx2d = canvas.getContext('2d');
  const clickCallbacks = new Set();
  const ustate = cheapClone(SURFACE_UNIFORMS);
  let rect = {};
  let visible;
  let ticking;
  let mousedown;

  function handleMouseDown(e) {
    clickCallbacks.forEach(cb => typeof cb === 'function' && cb());
    mousedown = true;
    const action = getMouseOrTouch(e);
    const {
      top,
      left,
      height
    } = rect;
    ustate[MOUSEDRAG].value[0] = ustate[MOUSEDRAG].value[2] = action[0] - Math.floor(left);
    ustate[MOUSEDRAG].value[1] = ustate[MOUSEDRAG].value[3] = Math.floor(height) - (action[1] - Math.floor(top));
  }

  function handleMouseMove(e) {
    if (!ticking) {
      const action = getMouseOrTouch(e);
      const {
        top,
        left,
        height
      } = rect;
      ustate[MOUSE].value[0] = action[0] - Math.floor(left);
      ustate[MOUSE].value[1] = Math.floor(height) - (action[1] - Math.floor(top));

      if (mousedown) {
        ustate[MOUSEDRAG].value[0] = ustate[MOUSE].value[0];
        ustate[MOUSEDRAG].value[1] = ustate[MOUSE].value[1];
      }

      ticking = true;
    }
  }

  function handleMouseUp(e) {
    mousedown = false;

    if (Math.sign(ustate[MOUSEDRAG].value[2]) === 1) {
      ustate[MOUSEDRAG].value[2] *= -1;
    }

    if (Math.sign(ustate[MOUSEDRAG].value[3]) === 1) {
      ustate[MOUSEDRAG].value[3] *= -1;
    }
  }

  function tick() {
    updateRect();
    ticking = false;
  }

  function updateRect() {
    const newRect = canvas.getBoundingClientRect();
    visible = newRect.top + newRect.height >= 0 && newRect.left + newRect.width >= 0 && newRect.bottom - newRect.height <= (window.innerHeight || document.documentElement.clientHeight) && newRect.right - newRect.width <= (window.innerWidth || document.documentElement.clientWidth);
    const h = sdNode.forcedHeight && sdNode.forcedHeight > 0 ? sdNode.forcedHeight : newRect.height;
    const w = sdNode.forcedWidth && sdNode.forcedWidth > 0 ? sdNode.forcedWidth : newRect.width;

    if (w !== rect.width) {
      canvas.width = ustate[RESOLUTION].value[0] = w;
    }

    if (h !== rect.height) {
      canvas.height = ustate[RESOLUTION].value[1] = h;
    }

    rect = {
      width: canvas.width,
      height: canvas.height
    };
  }

  function render(rendererCanvas, updateRendererSize, rendererWidth, rendererHeight, pixelRatio, ustateArray) {
    tick();
    if (!visible || !program) return;
    const width = rect.width || 0;
    const height = rect.height || 0;
    updateRendererSize(width, height);
    program.render(width, height, [...ustateArray, ...ustate]); // copy renderer to surface canvas

    const pixelWidth = width * pixelRatio;
    const pixelHeight = height * pixelRatio;
    ctx2d.clearRect(0, 0, pixelWidth, pixelHeight);
    ctx2d.drawImage(rendererCanvas, 0, rendererHeight - pixelHeight, pixelWidth, pixelHeight, 0, 0, pixelWidth, pixelHeight);
  }

  function addClick(cb) {
    clickCallbacks.add(cb);
  }

  function dispose() {
    clickCallbacks.clear();
    canvas.removeEventListener('mousedown', handleMouseDown);
    canvas.removeEventListener('mousemove', handleMouseMove);
    canvas.removeEventListener('mouseup', handleMouseUp);
    canvas.removeEventListener('mouseout', handleMouseUp);
    canvas.removeEventListener('touchstart', handleMouseDown);
    canvas.removeEventListener('touchmove', handleMouseMove);
    canvas.removeEventListener('touchend', handleMouseUp);
  }

  canvas.addEventListener('mousedown', handleMouseDown);
  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('mouseup', handleMouseUp);
  canvas.addEventListener('mouseout', handleMouseUp);
  canvas.addEventListener('touchstart', handleMouseDown);
  canvas.addEventListener('touchmove', handleMouseMove);
  canvas.addEventListener('touchend', handleMouseUp);
  updateRect();
  return Object.freeze({
    get dom() {
      return canvas;
    },

    render,
    addClick,
    dispose
  });
}

class ShaderDoodleElement extends SDNodeElement {
  constructor() {
    super();
    this.shadow = this.attachShadow({
      mode: 'open'
    });
  }

  connectedCallback() {
    setTimeout(() => {
      try {
        this.init();
      } catch (e) {
        console.error(e && e.message || 'Error in shader-doodle.');
      }
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.renderer.removeSurface(this.surface);
    this.surface.dispose();
    this.surface = undefined;
  }

  async init() {
    Renderer.resetSingleton();
    this.shadow.innerHTML = Template.render();
    const canvas = Template.map(this.shadow).canvas;
    await super.init();
    this.surface = Surface(canvas, this.program, this);
    this.renderer.addSurface(this.surface);
  }

}

if (!customElements.get('shader-doodle')) {
  customElements.define('shader-doodle', ShaderDoodleElement);
}
