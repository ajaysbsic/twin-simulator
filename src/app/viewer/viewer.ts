import {
  Component, ElementRef, EventEmitter, ViewChild,
  AfterViewInit, Inject, PLATFORM_ID, Output, Input
} from '@angular/core';

import { isPlatformBrowser } from '@angular/common';
import * as THREE from 'three';
import { ProjectModel } from '../models/project.model';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

@Component({
  selector: 'app-viewer',
  standalone: true,
  templateUrl: './viewer.html',
  styleUrl: './viewer.css',
})
export class ViewerComponent implements AfterViewInit {

  @Input() project!: ProjectModel;
  @Output() meshClicked = new EventEmitter<string>();
  @Output() componentAssembled = new EventEmitter<string>();
  @ViewChild('canvas') canvasRef!: ElementRef;

  isStlMode = false;
  private isBrowser: boolean;

  scene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;
  renderer!: THREE.WebGLRenderer;

  meshMap: { [key: string]: THREE.Mesh } = {};
  slotMap: { [key: string]: THREE.Mesh } = {};

  stackOffset = { x: 3, y: -1.5 };

  private stlLoadedCount = 0;
  private stlTotal = 0;
  private stlReady = false;
  private currentStep = 0;
  private movingComponentId: string | null = null;

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  loader = new STLLoader();

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnChanges() {
    if (!this.project) return;
    this.isStlMode = this.project.models?.length > 0;
  }

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;

    this.canvasRef.nativeElement.addEventListener('click', (event: MouseEvent) => {
      this.onCanvasClick(event);
    });

    this.initScene();
    this.animate();
  }

  initScene() {
    const width = this.canvasRef.nativeElement.clientWidth || window.innerWidth;
    const height = this.canvasRef.nativeElement.clientHeight || window.innerHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#050816');

    this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    this.camera.position.z = 6;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvasRef.nativeElement,
      antialias: true,
    });

    this.renderer.setSize(width, height);

    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(2, 2, 5);
    this.scene.add(light);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));

    if (this.isStlMode) {
      this.loadProjectModels();
    } else {
      this.loadCubeSimulation();
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    Object.values(this.meshMap).forEach(mesh => {
      if (!mesh.userData['assembled'] && !mesh.userData['isMoving']) {
        mesh.rotation.y += mesh.userData['rotationSpeed'] || 0.002;
      }

      const target = mesh.userData['targetPosition'];

      if (target) {
        mesh.position.x += (target.x - mesh.position.x) * 0.08;
        mesh.position.y += (target.y - mesh.position.y) * 0.08;
        mesh.position.z += (target.z - mesh.position.z) * 0.08;

        const distance =
          Math.abs(target.x - mesh.position.x) +
          Math.abs(target.y - mesh.position.y) +
          Math.abs(target.z - mesh.position.z);

        if (distance < 0.01) {
          mesh.position.set(target.x, target.y, target.z);
          mesh.userData['targetPosition'] = null;
          mesh.rotation.set(0, 0, 0);

          const onArrival = mesh.userData['onArrival'];
          mesh.userData['onArrival'] = null;

          if (typeof onArrival === 'function') {
            onArrival();
          }
        }
      }
    });

    this.renderer.render(this.scene, this.camera);
  }

  loadSTL(model: any, index: number) {
    if (!this.isStlMode) return;

    this.loader.load(model.file, (geometry) => {
      geometry.center();

      const material = new THREE.MeshStandardMaterial({ color: 0xbdbdbd });
      const mesh = new THREE.Mesh(geometry, material);

      const scale = model.scale || 0.006;
      mesh.scale.set(scale, scale, scale);

      const initialPosition =
        model.initialPosition || this.getFloatingPosition(index);

      mesh.position.set(
        initialPosition[0],
        initialPosition[1],
        initialPosition[2]
      );

      mesh.rotation.x = -Math.PI / 2;
      mesh.updateMatrixWorld(true);

      mesh.userData['componentId'] = model.id;
      mesh.userData['assembled'] = false;
      mesh.userData['isMoving'] = false;
      mesh.userData['targetPosition'] = null;
      mesh.userData['finalPosition'] = model.targetPosition;
      mesh.userData['rotationSpeed'] = 0.001 + Math.random() * 0.002;

      this.scene.add(mesh);
      this.meshMap[model.id] = mesh;

      this.stlLoadedCount++;
      if (this.stlLoadedCount === this.stlTotal) {
        this.stlReady = true;
      }
    });
  }

  loadProjectModels() {
    this.stlTotal = this.project.models.length;
    this.stlLoadedCount = 0;
    this.stlReady = false;
    this.currentStep = 0;
    this.movingComponentId = null;
    this.project?.models?.forEach((m, i) => this.loadSTL(m, i));
  }

  loadCubeSimulation() {
    this.createSlot('base', 0, 0);
    this.createSlot('motor', 0, 1.2);
    this.createSlot('cover', 0, 2.4);

    this.createComponent('base', 0xfffff9, -2);
    this.createComponent('motor', 0xfffff9, 0);
    this.createComponent('cover', 0xfffff9, 2);
  }

  createSlot(id: string, x: number, y: number) {
    const geometry = new THREE.BoxGeometry(1.2, 1.2, 1.2);

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.2,
    });

    const slot = new THREE.Mesh(geometry, material);

    slot.position.set(
      x + this.stackOffset.x,
      y + this.stackOffset.y,
      0
    );

    this.scene.add(slot);
    this.slotMap[id] = slot;
  }

  createComponent(id: string, color: number, x: number) {
    if (this.isStlMode) return;

    const geometry = new THREE.BoxGeometry();
    const texture = this.createTextTexture(id);

    const material = new THREE.MeshStandardMaterial({ map: texture });

    const mesh = new THREE.Mesh(geometry, material);

    mesh.position.set(x, 2, 0);

    mesh.userData['componentId'] = id;
    mesh.userData['assembled'] = false;
    mesh.userData['isMoving'] = false;
    mesh.userData['targetPosition'] = null;

    this.scene.add(mesh);
    this.meshMap[id] = mesh;
  }

  onCanvasClick(event: MouseEvent) {
    if (this.isStlMode && !this.stlReady) return;
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();

    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const hits = this.raycaster.intersectObjects(Object.values(this.meshMap));

    if (hits.length > 0) {
      const mesh = hits[0].object as THREE.Mesh;
      const id = Object.keys(this.meshMap).find(k => this.meshMap[k] === mesh);

      if (id) {
        this.meshClicked.emit(id);
      }
    }
  }

  attachComponent(componentId: string): boolean {
    const mesh = this.meshMap[componentId];
    if (!mesh) return false;

    if (this.isStlMode) {
      if (this.movingComponentId || mesh.userData['assembled'] || mesh.userData['isMoving']) {
        return false;
      }

      const expectedModel = this.project.models[this.currentStep];

      if (!expectedModel || expectedModel.id !== componentId) {
        this.markError(componentId);
        return false;
      }

      const finalPosition =
        mesh.userData['finalPosition'] || this.getDefaultFinalPosition(this.currentStep);

      this.movingComponentId = componentId;
      mesh.userData['isMoving'] = true;

      mesh.userData['targetPosition'] = {
        x: 3,
        y: -4,
        z: 0
      };

      mesh.userData['onArrival'] = () => {
        mesh.userData['targetPosition'] = {
          x: finalPosition[0] + this.stackOffset.x,
          y: finalPosition[1] + this.stackOffset.y,
          z: finalPosition[2]
        };

        mesh.userData['onArrival'] = () => {
          mesh.userData['assembled'] = true;
          mesh.userData['isMoving'] = false;
          this.movingComponentId = null;
          this.currentStep++;
          this.componentAssembled.emit(componentId);
        };
      };

      return true;
    }

    const slot = this.slotMap[componentId];
    if (!slot || mesh.userData['assembled'] || mesh.userData['isMoving']) return false;

    mesh.userData['isMoving'] = true;
    mesh.userData['targetPosition'] = {
      x: slot.position.x,
      y: slot.position.y,
      z: slot.position.z
    };

    mesh.userData['onArrival'] = () => {
      mesh.userData['assembled'] = true;
      mesh.userData['isMoving'] = false;
      this.componentAssembled.emit(componentId);
    };

    const material = slot.material as THREE.MeshStandardMaterial;

    material.color.set(0x00ff00);
    material.transparent = true;
    material.opacity = 0.6;
    material.needsUpdate = true;

    return true;
  }

  markError(componentId: string) {
    const mesh = this.meshMap[componentId];
    if (!mesh) return;

    const mat = mesh.material as THREE.MeshStandardMaterial;
    const original = mat.color.getHex();

    mat.color.set(0xff0000);

    setTimeout(() => mat.color.set(original), 500);
  }

  createTextTexture(text: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;

    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 256, 256);

    ctx.fillStyle = '#000';
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 128);

    return new THREE.CanvasTexture(canvas);
  }

  private getFloatingPosition(index: number): number[] {
    const spacing = 2.5;
    const total = this.project.models.length;
    const startX = -((total - 1) * spacing) / 2;

    return [startX + index * spacing, 2, 0];
  }

  private getDefaultFinalPosition(index: number): number[] {
    const yPositions = [-2, -1.2, -1.1, -0.1, 0.2];
    return [0, yPositions[index] ?? -2 + index * 0.7, 0];
  }
}
