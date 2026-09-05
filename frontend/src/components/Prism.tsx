/* Landing hero: a glass triangular prism splitting a white beam into amber/emerald/blue
   rays, drifting in a field of dust, with gentle mouse parallax. Plain three.js on a
   canvas ref; disposed on unmount, paused when hidden, static under reduced motion. */
import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function Prism({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, powerPreference: "low-power" });
    } catch { return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const w = cv.clientWidth || 1200, h = cv.clientHeight || 860;
    renderer.setSize(w, h, false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(46, w / h, 0.1, 100);
    camera.position.set(0, 0, 9);

    const group = new THREE.Group();
    const prismGeo = new THREE.CylinderGeometry(2.05, 2.05, 3.4, 3, 1);
    const prismMat = new THREE.MeshPhysicalMaterial({
      color: 0x0b1220, metalness: 0.1, roughness: 0.08, transmission: 0.92, thickness: 2.4, ior: 1.62,
      clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.95,
    });
    const prism = new THREE.Mesh(prismGeo, prismMat);
    prism.rotation.z = Math.PI / 2;
    group.add(prism);

    const edgesGeo = new THREE.EdgesGeometry(prismGeo);
    const edgesMat = new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.55 });
    const edges = new THREE.LineSegments(edgesGeo, edgesMat);
    edges.rotation.z = Math.PI / 2;
    group.add(edges);

    const coreGeo = new THREE.SphereGeometry(0.42, 32, 32);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfcd34d });
    const core = new THREE.Mesh(coreGeo, coreMat);
    group.add(core);

    const beams = new THREE.Group();
    const beamColors = [0xf59e0b, 0xfbbf24, 0xfcd34d, 0x34d399, 0x60a5fa];
    const beamGeo = new THREE.PlaneGeometry(9, 0.055);
    const beamMats: THREE.MeshBasicMaterial[] = [];
    for (let i = 0; i < 5; i++) {
      const m = new THREE.MeshBasicMaterial({ color: beamColors[i], transparent: true, opacity: 0.34, side: THREE.DoubleSide });
      beamMats.push(m);
      const beam = new THREE.Mesh(beamGeo, m);
      beam.position.x = 5.4;
      const holder = new THREE.Group();
      holder.rotation.z = (i - 2) * 0.075;
      holder.add(beam);
      beams.add(holder);
    }
    group.add(beams);

    const inGeo = new THREE.PlaneGeometry(9, 0.07);
    const inMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
    const inbeam = new THREE.Mesh(inGeo, inMat);
    inbeam.position.x = -5.4;
    group.add(inbeam);

    const pts: number[] = [];
    for (let j = 0; j < 900; j++) {
      const r = 6 + Math.random() * 14, t = Math.random() * Math.PI * 2, p = Math.acos(2 * Math.random() - 1);
      pts.push(r * Math.sin(p) * Math.cos(t), r * Math.sin(p) * Math.sin(t) * 0.5, r * Math.cos(p) - 6);
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const dustMat = new THREE.PointsMaterial({ size: 0.035, color: 0xe2e8f0, transparent: true, opacity: 0.38 });
    const dust = new THREE.Points(dustGeo, dustMat);
    scene.add(dust);

    group.position.set(0.4, -1.4, -3.2);
    group.scale.setScalar(0.82);
    scene.add(group);
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xfff3cf, 3.2); key.position.set(5, 6, 8); scene.add(key);
    const fill = new THREE.PointLight(0xf59e0b, 60, 40); fill.position.set(-6, -3, 3); scene.add(fill);
    const rim = new THREE.PointLight(0x60a5fa, 28, 40); rim.position.set(2, 4, -6); scene.add(rim);

    const mouse = { x: 0, y: 0 };
    const onMove = (e: MouseEvent) => { mouse.x = (e.clientX / window.innerWidth - 0.5) * 2; mouse.y = (e.clientY / window.innerHeight - 0.5) * 2; };
    window.addEventListener("mousemove", onMove);

    let raf = 0;
    let running = true;
    const t0 = performance.now();
    const frame = () => {
      const el = (performance.now() - t0) / 1000;
      group.rotation.y = el * 0.22;
      group.rotation.x = Math.sin(el * 0.4) * 0.12;
      group.position.y = -1.4 + Math.sin(el * 0.6) * 0.16;
      beams.rotation.x = Math.sin(el * 0.5) * 0.08;
      core.scale.setScalar(1 + Math.sin(el * 2.2) * 0.09);
      dust.rotation.y = el * 0.015;
      camera.position.x += (mouse.x * 1.1 - camera.position.x) * 0.04;
      camera.position.y += (-mouse.y * 0.7 - camera.position.y) * 0.04;
      camera.lookAt(0, 0, 0);
      const nw = cv.clientWidth, nh = cv.clientHeight;
      if (nw && nh && (cv.width !== nw * renderer.getPixelRatio() || cv.height !== nh * renderer.getPixelRatio())) {
        renderer.setSize(nw, nh, false); camera.aspect = nw / nh; camera.updateProjectionMatrix();
      }
      renderer.render(scene, camera);
    };
    const loop = () => { if (!running) return; frame(); raf = requestAnimationFrame(loop); };
    const onVis = () => { if (document.hidden) { running = false; cancelAnimationFrame(raf); } else if (!reduced) { running = true; loop(); } };
    document.addEventListener("visibilitychange", onVis);

    if (reduced) { group.rotation.y = 0.6; frame(); } else loop();

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("visibilitychange", onVis);
      [prismGeo, edgesGeo, coreGeo, beamGeo, inGeo, dustGeo].forEach((g) => g.dispose());
      [prismMat, edgesMat, coreMat, inMat, dustMat, ...beamMats].forEach((m) => m.dispose());
      renderer.dispose();
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden />;
}
