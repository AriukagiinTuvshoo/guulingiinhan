'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Marriage, personName, TreeData, TreePerson } from '../lib/api';
import { layoutTree3D, Point3 } from '../lib/tree-3d-layout';

type Props = {
  data: TreeData;
  selectedPersonId: string;
  currentPersonId?: string | null;
  canonicalRootId?: string | null;
  focusRequest?: number;
  onSelect: (personId: string) => void;
  onFallback: () => void;
};

function makeLabel(person: TreePerson, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = 'rgba(15, 38, 31, 0.88)';
    context.beginPath();
    context.roundRect(4, 4, 504, 88, 22);
    context.fill();
    context.strokeStyle = color;
    context.lineWidth = 3;
    context.stroke();
    context.fillStyle = '#f5efdc';
    context.font = '600 32px Georgia, serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const name = personName(person) || 'Нэргүй хүн';
    context.fillText(name.length > 27 ? name.slice(0, 26) + '…' : name, 256, 49, 475);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(7.1, 1.34, 1);
  sprite.position.y = 1.65;
  return sprite;
}

export default function Tree3DScene({
  data, selectedPersonId, currentPersonId, canonicalRootId, focusRequest = 0, onSelect, onFallback,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const objectsRef = useRef<THREE.Object3D[]>([]);
  const positionsRef = useRef<Map<string, Point3>>(new Map());
  const [webglError, setWebglError] = useState(false);
  const [ready, setReady] = useState(false);
  const [selectedContext, setSelectedContext] = useState('');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    } catch {
      setWebglError(true);
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(host.clientWidth, host.clientHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x102b23, 1);
    host.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-hidden', 'true');
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x102b23);
    scene.fog = new THREE.Fog(0x102b23, 70, 180);
    scene.add(new THREE.HemisphereLight(0xe8dfc5, 0x203c31, 2.1));
    const keyLight = new THREE.DirectionalLight(0xffe5a4, 2.4);
    keyLight.position.set(20, 40, 25);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xb4c9b7, 0.8);
    fillLight.position.set(-30, 10, -20);
    scene.add(fillLight);

    const camera = new THREE.PerspectiveCamera(42, host.clientWidth / Math.max(host.clientHeight, 1), 0.1, 400);
    camera.position.set(28, 22, 39);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.minDistance = 9;
    controls.maxDistance = 160;
    controls.maxPolarAngle = Math.PI * 0.88;
    controls.target.set(0, 0, 0);

    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    rendererRef.current = renderer;
    setReady(true);

    const resize = new ResizeObserver(() => {
      if (!host.clientWidth || !host.clientHeight) return;
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight, false);
      invalidate();
    });
    resize.observe(host);

    let frame = 0;
    const render = () => {
      frame = 0;
      controls.update();
      renderer.render(scene, camera);
    };
    const invalidate = () => {
      if (!frame) frame = window.requestAnimationFrame(render);
    };
    controls.addEventListener('change', invalidate);
    invalidate();

    return () => {
      window.cancelAnimationFrame(frame);
      resize.disconnect();
      controls.removeEventListener('change', invalidate);
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Sprite) {
          object.geometry?.dispose?.();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose();
            material.dispose();
          }
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      objectsRef.current = [];
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      rendererRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    for (const object of objectsRef.current) {
      scene.remove(object);
      object.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Sprite) {
          child.geometry?.dispose?.();
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          for (const material of materials) {
            if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose();
            material.dispose();
          }
        }
      });
    }

    const { positions } = layoutTree3D(data);
    positionsRef.current = positions;
    const nextObjects: THREE.Object3D[] = [];
    const personIds = new Set(data.persons.map((person) => person.id));
    const byId = new Map(data.persons.map((person) => [person.id, person]));
    for (const edge of data.parent_child_relationships) {
      const start = positions.get(edge.parent_id);
      const end = positions.get(edge.child_id);
      if (!start || !end) continue;
      const points = [new THREE.Vector3(start.x, start.y, start.z), new THREE.Vector3(end.x, end.y, end.z)];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xd2bd82, transparent: true, opacity: 0.68 }));
      line.userData.relationshipType = 'parent-child';
      nextObjects.push(line);
      scene.add(line);
    }
    for (const marriage of data.marriages) {
      const start = positions.get(marriage.person_1_id);
      const end = positions.get(marriage.person_2_id);
      if (!start || !end) continue;
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(start.x, start.y, start.z), new THREE.Vector3(end.x, end.y, end.z),
      ]);
      const current = marriage.status === 'married';
      const line = new THREE.Line(geometry, current
        ? new THREE.LineBasicMaterial({ color: 0xe7ca7c, linewidth: 2.4, transparent: true, opacity: 0.92 })
        : new THREE.LineDashedMaterial({ color: 0xa99059, dashSize: 0.8, gapSize: 0.48, transparent: true, opacity: 0.72 }));
      if (!current) line.computeLineDistances();
      line.userData.relationshipType = 'spouse';
      line.userData.status = marriage.status;
      nextObjects.push(line);
      scene.add(line);
    }

    const labeledPeople = new Set<string>([selectedPersonId, currentPersonId ?? '', canonicalRootId ?? '']);
    const selectedParents = data.parent_child_relationships
      .filter((edge) => edge.child_id === selectedPersonId)
      .map((edge) => edge.parent_id);
    for (const edge of data.parent_child_relationships) {
      if (edge.parent_id === selectedPersonId) labeledPeople.add(edge.child_id);
      if (edge.child_id === selectedPersonId) labeledPeople.add(edge.parent_id);
      if (selectedParents.includes(edge.parent_id)) labeledPeople.add(edge.child_id);
    }
    for (const marriage of data.marriages) {
      if (marriage.person_1_id === selectedPersonId) labeledPeople.add(marriage.person_2_id);
      if (marriage.person_2_id === selectedPersonId) labeledPeople.add(marriage.person_1_id);
    }
    const labelsToShow = new Set([...labeledPeople].filter((id) => personIds.has(id)).slice(0, 72));

    let labelsCreated = 0;
    for (const person of data.persons) {
      const point = positions.get(person.id);
      if (!point) continue;
      const isRoot = person.id === canonicalRootId;
      const isCurrent = person.id === currentPersonId;
      const isSelected = person.id === selectedPersonId;
      const geometry: THREE.BufferGeometry = isRoot
        ? new THREE.IcosahedronGeometry(isSelected ? 1.55 : 1.3, 1)
        : new THREE.SphereGeometry(isSelected ? 1.28 : 0.88, 16, 12);
      const color = isRoot ? 0xe9ca71 : isSelected ? 0xffefd0 : isCurrent ? 0x8bb59a : 0x6e9276;
      const material = new THREE.MeshStandardMaterial({
        color, roughness: 0.52, metalness: isRoot ? 0.22 : 0.06,
        emissive: color, emissiveIntensity: isSelected ? 0.18 : isRoot ? 0.12 : 0.035,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(point.x, point.y, point.z);
      mesh.userData.personId = person.id;
      mesh.userData.personName = personName(person);
      mesh.userData.isRoot = isRoot;
      scene.add(mesh);
      nextObjects.push(mesh);

      if (isCurrent && !isRoot) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(1.27, 0.075, 8, 28),
          new THREE.MeshStandardMaterial({ color: 0xb4d0b8, roughness: 0.42, metalness: 0.12 }),
        );
        ring.position.copy(mesh.position);
        ring.rotation.x = Math.PI / 2;
        ring.userData.personId = person.id;
        scene.add(ring);
        nextObjects.push(ring);
      }

      if (labelsToShow.has(person.id) && labelsCreated < 72) {
        const label = makeLabel(person, isRoot ? '#e9ca71' : isSelected ? '#fff0cc' : '#819f87');
        label.position.set(point.x, point.y + 1.45, point.z);
        label.userData.personId = person.id;
        scene.add(label);
        nextObjects.push(label);
        labelsCreated += 1;
      }
    }

    const floorGeometry = new THREE.CircleGeometry(Math.max(11, Math.sqrt(data.persons.length) * 2), 64);
    const floor = new THREE.Mesh(floorGeometry, new THREE.MeshBasicMaterial({ color: 0x254438, transparent: true, opacity: 0.27, side: THREE.DoubleSide }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = Math.min(...[...positions.values()].map((point) => point.y)) - 3;
    scene.add(floor);
    nextObjects.push(floor);

    objectsRef.current = nextObjects;
    if (cameraRef.current) rendererRef.current?.render(scene, cameraRef.current);
    if (selectedPersonId && personIds.has(selectedPersonId)) setSelectedContext(byId.get(selectedPersonId)?.branch_name ?? '');
  }, [canonicalRootId, currentPersonId, data, selectedPersonId]);

  useEffect(() => {
    const controls = controlsRef.current;
    const camera = cameraRef.current;
    const point = positionsRef.current.get(selectedPersonId);
    if (!controls || !camera || !point) return;
    const destination = new THREE.Vector3(point.x, point.y, point.z);
    const offset = camera.position.clone().sub(controls.target);
    const distance = Math.max(16, Math.min(52, offset.length()));
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      controls.target.copy(destination);
      camera.position.copy(destination.clone().add(new THREE.Vector3(distance * 0.62, distance * 0.45, distance * 0.82)));
      controls.update();
      return;
    }
    const startTarget = controls.target.clone();
    const startPosition = camera.position.clone();
    const endPosition = destination.clone().add(new THREE.Vector3(distance * 0.62, distance * 0.45, distance * 0.82));
    const startAt = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      const raw = Math.min(1, (now - startAt) / 420);
      const amount = raw * raw * (3 - 2 * raw);
      controls.target.lerpVectors(startTarget, destination, amount);
      camera.position.lerpVectors(startPosition, endPosition, amount);
      rendererRef.current?.render(sceneRef.current!, camera);
      if (raw < 1) frame = window.requestAnimationFrame(animate);
      else controls.update();
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [selectedPersonId, data]);

  useEffect(() => {
    if (focusRequest) focusSelected();
  }, [focusRequest]);

  function focusSelected() {
    const point = positionsRef.current.get(selectedPersonId);
    const controls = controlsRef.current;
    const camera = cameraRef.current;
    if (!point || !controls || !camera) return;
    controls.target.set(point.x, point.y, point.z);
    camera.position.set(point.x + 20, point.y + 15, point.z + 27);
    controls.update();
  }

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const handleClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, cameraRef.current!);
      const hit = raycaster.intersectObjects(objectsRef.current, false).find((item) => typeof item.object.userData.personId === 'string');
      const id = hit?.object.userData.personId;
      if (typeof id === 'string') onSelect(id);
    };
    renderer.domElement.addEventListener('click', handleClick);
    return () => renderer.domElement.removeEventListener('click', handleClick);
  }, [data, onSelect]);

  const selectedPerson = data.persons.find((person) => person.id === selectedPersonId);
  const selectedMarriages: Marriage[] = selectedPerson
    ? data.marriages.filter((marriage) => marriage.person_1_id === selectedPerson.id || marriage.person_2_id === selectedPerson.id)
    : [];
  const visibleNodeCount = data.persons.length;

  return (
    <section className="tree-3d-panel" aria-label="3D удмын мод">
      <div className="tree-3d-stage" role="group" aria-label={`Орон зайн удмын зураглал. ${visibleNodeCount} зөвшөөрөгдсөн хүн.`}>
        <div className="tree-3d-canvas" ref={hostRef} aria-hidden="true" />
        {!ready && !webglError && <div className="tree-3d-loading" role="status">Удмын орон зайг байгуулж байна…</div>}
        {webglError && (
          <div className="tree-3d-fallback" role="status">
            <strong>3D дүрслэл энэ төхөөрөмж дээр ажиллахгүй байна.</strong>
            <span>Одоо байгаа 2D зураглал болон харилцааны жагсаалтыг ашиглаж болно.</span>
            <button type="button" onClick={onFallback}>2D харагдац нээх</button>
          </div>
        )}
      </div>
      {!webglError && (
        <div className="tree-3d-overlay">
          <div className="tree-3d-legend" aria-label="Холбоосын тайлбар">
            <span><i className="tree-legend-parent" /> Эцэг/эх — хүүхэд</span>
            <span><i className="tree-legend-current" /> Одоогийн гэрлэлт</span>
            <span><i className="tree-legend-history" /> Түүхэн гэрлэлт</span>
            <span><i className="tree-legend-root" /> Удмын эх</span>
            <span><i className="tree-legend-self" /> Миний хүн</span>
          </div>
          <div className="tree-3d-hint">Чирж эргүүлэх · баруун товчоор зөөх · дугуйгаар томруулах</div>
          <button type="button" className="tree-3d-focus" onClick={focusSelected}>Сонгосон хүнийг төвлөрүүлэх</button>
        </div>
      )}
      {selectedPerson && (
        <p className="tree-3d-context" aria-live="polite">
          {personName(selectedPerson)}{selectedContext ? ` · ${selectedContext}` : ''} · {selectedMarriages.length} гэрлэлтийн холбоос
        </p>
      )}
      <div className="tree-3d-accessible-list" aria-label="3D модны хүртээмжтэй жагсаалт">
        {data.persons.map((person) => (
          <button key={person.id} type="button" aria-pressed={person.id === selectedPersonId} onClick={() => onSelect(person.id)}>
            {person.id === canonicalRootId ? 'Удмын эх · ' : ''}{person.id === currentPersonId ? 'Миний хүн · ' : ''}{personName(person)}
          </button>
        ))}
      </div>
      {data.meta?.truncated && <p className="tree-3d-limit" role="status">Одоогийн фокусын хүрээний {visibleNodeCount} хүнийг дүрсэллээ. Бусад хүнийг хайж сонгоход тухайн хүний эргэн тойрны зөвшөөрөгдсөн холбоосыг дахин ачаална.</p>}
    </section>
  );
}
