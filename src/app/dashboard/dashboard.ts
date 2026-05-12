import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ProjectService } from '../services/project.service';
import { AssetStorageService } from '../services/asset-storage.service';
import { ProjectHierarchyNode, ProjectModel, ProjectFileModel } from '../models/project.model';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface GlbImportPreview {
  project: ProjectModel;
  hierarchy: ProjectHierarchyNode[];
  parts: ProjectFileModel[];
}

interface ImportStage {
  message: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class DashboardComponent {

  projects: ProjectModel[] = [];

  projectName = '';
  projectDescription = '';
  configText = '';
  configFileName = '';
  selectedModelFiles: File[] = [];
  selectedGlbFile: File | null = null;
  thumbnailDataUrl = '';
  thumbnailFileName = '';
  editingProject: ProjectModel | null = null;
  showProjectDialog = false;
  showImportPreview = false;
  importPreview: GlbImportPreview | null = null;
  isImporting = false;
  currentImportStage = '';
  completedStages: string[] = [];
  importError = '';
  dialogError = '';
  private gltfLoader = new GLTFLoader();
  private readonly IMPORT_TIMEOUT_MS = 60000;
  readonly importStages: ImportStage[] = [
    { message: 'Uploading File' },
    { message: 'Parsing GLB' },
    { message: 'Traversing Scene Graph' },
    { message: 'Detecting Meshes' },
    { message: 'Extracting Hierarchy' },
    { message: 'Generating Exploded View' },
    { message: 'Building Assembly Sequence' },
    { message: 'Generating Metadata' },
    { message: 'Saving Project' },
    { message: 'Completed' }
  ];

  constructor(
    private projectService: ProjectService,
    private assetStorage: AssetStorageService,
    private router: Router
  ) {}

  ngOnInit() {
    this.initializeProjects();
  }

  async initializeProjects() {
    const projects = this.projectService.getProjects();
    const defaultProject = await this.loadDefaultProject();
    const cubeProject = this.getCubeProject();

    if (projects.length === 0) {
      this.projectService.addProject(cubeProject);
      this.projectService.addProject(defaultProject);
    } else {
      const demoProject = projects.find(p => p.id === defaultProject.id);
      const savedCubeProject = projects.find(p => p.id === cubeProject.id);

      if (demoProject) {
        this.projectService.updateProject({
          ...demoProject,
          models: defaultProject.models
        });
      }

      if (!savedCubeProject) {
        this.projectService.addProject(cubeProject);
      }
    }

    this.loadProjects();
  }

  loadProjects() {
    this.projects = this.projectService.getProjects();
  }

  openCreateDialog() {
    this.editingProject = null;
    this.projectName = '';
    this.projectDescription = '';
    this.configText = '';
    this.configFileName = '';
    this.selectedModelFiles = [];
    this.selectedGlbFile = null;
    this.thumbnailDataUrl = '';
    this.thumbnailFileName = '';
    this.importPreview = null;
    this.showImportPreview = false;
    this.isImporting = false;
    this.currentImportStage = '';
    this.completedStages = [];
    this.importError = '';
    this.dialogError = '';
    this.showProjectDialog = true;
  }

  openEditDialog(project: ProjectModel) {
    this.editingProject = project;
    this.projectName = project.name;
    this.projectDescription = project.description || '';
    this.configText = JSON.stringify({ models: project.models }, null, 2);
    this.configFileName = 'Current project config';
    this.selectedModelFiles = [];
    this.selectedGlbFile = null;
    this.thumbnailDataUrl = project.thumbnail || '';
    this.thumbnailFileName = project.thumbnail ? 'Current thumbnail' : '';
    this.importPreview = null;
    this.showImportPreview = false;
    this.dialogError = '';
    this.showProjectDialog = true;
  }

  closeProjectDialog() {
    this.showProjectDialog = false;
    this.showImportPreview = false;
  }

  onConfigSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {
      this.configText = String(reader.result || '');
      this.configFileName = file.name;
      this.dialogError = '';
    };

    reader.readAsText(file);
  }

  onModelsSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;

    this.selectedGlbFile = file;
    this.selectedModelFiles = file ? [file] : [];
    this.importPreview = null;
    this.showImportPreview = false;
    this.dialogError = '';

    if (file && this.getModelFileType(file.name) !== 'glb') {
      this.selectedGlbFile = null;
      this.selectedModelFiles = [];
      this.dialogError = 'Upload one GLB assembly file.';
    }
  }

  onThumbnailSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {
      this.thumbnailDataUrl = String(reader.result || '');
      this.thumbnailFileName = file.name;
    };

    reader.readAsDataURL(file);
  }

  async saveProjectFromDialog() {
    if (!this.projectName.trim()) {
      this.dialogError = 'Project name is required.';
      return;
    }

    try {
      if (this.importPreview) {
        this.confirmImport();
        return;
      }

      if (!this.selectedGlbFile) {
        this.dialogError = 'Upload one GLB assembly file.';
        return;
      }

      await this.processGlbImport(this.selectedGlbFile);
    } catch (error) {
      this.dialogError =
        error instanceof Error ? error.message : 'Unable to import the GLB assembly.';
      this.isImporting = false;
      this.currentImportStage = '';
    }
  }

  confirmImport() {
    if (!this.importPreview) return;

    const project = this.importPreview.project;

    if (this.editingProject) {
      this.projectService.updateProject(project);
    } else {
      this.projectService.addProject(project);
    }

    this.closeProjectDialog();
    this.loadProjects();
  }

  cancelImportPreview() {
    this.importPreview = null;
    this.showImportPreview = false;
  }

  private async processGlbImport(file: File) {
    try {
      this.isImporting = true;
      this.completedStages = [];
      this.currentImportStage = '';
      this.importError = '';
      this.dialogError = '';

      await this.runImportPipeline(file);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : 'Unable to import the GLB assembly.';
      this.importError = message;
      this.dialogError = message;
    } finally {
      this.isImporting = false;
      this.currentImportStage = '';
    }
  }

  deleteProject(id: string) {
    this.projectService.deleteProject(id);
    this.loadProjects();
  }

  openProject(project: ProjectModel) {
    this.router.navigate([
      '/viewer',
      project.id
    ]);
  }

  private async loadDefaultProject(): Promise<ProjectModel> {
    const response = await fetch('/configs/stl-project-config.json');
    const config = await response.json();

    return {
      id: 'demo-simulator',
      name: 'Assembly Simulator',
      description: 'Default STL assembly project',
      models: config.models || []
    };
  }

  private getCubeProject(): ProjectModel {
    return {
      id: 'cube-simulator',
      name: 'Cube Assembly Demo',
      description: 'Classic hardcoded cube sequence with base, motor, and cover',
      models: []
    };
  }

  private async runImportPipeline(file: File) {
    await this.advanceImportStage(0);
    await this.advanceImportStage(1);
    const scene = await this.loadGlbFromFile(file);
    scene.updateMatrixWorld(true);

    await this.advanceImportStage(2);
    const hierarchy = this.buildHierarchyTree(scene);

    await this.advanceImportStage(3);
    const meshes = this.detectSceneMeshes(scene);

    if (!meshes.length) {
      throw new Error('No mesh parts were detected in this GLB.');
    }

    this.currentImportStage = `Detecting ${meshes.length} Parts`;

    await this.advanceImportStage(4);
    const modelBox = new THREE.Box3().setFromObject(scene);
    const modelCenter = modelBox.getCenter(new THREE.Vector3());
    const modelSize = modelBox.getSize(new THREE.Vector3());
    const explodeDistance = Math.max(modelSize.length() * 0.14, modelSize.y * 0.2, 0.8);
    const projectId = this.editingProject?.id || Date.now().toString();
    const sourceFileReference = `indexeddb://${projectId}/source.glb`;
    const rawParts = meshes.map((mesh, index) =>
      this.createPartMetadata(mesh, index, modelCenter, explodeDistance, file.name, sourceFileReference)
    );

    await this.advanceImportStage(5);
    const partsWithExplodedPositions = this.generateExplodedPositions(rawParts, modelCenter, explodeDistance);

    await this.advanceImportStage(6);
    const orderedParts = this.generateAssemblySequence(partsWithExplodedPositions);

    await this.advanceImportStage(7);
    const storedSourceFile = await this.assetStorage.saveAsset(projectId, file);
    const project: ProjectModel = {
      id: projectId,
      name: this.projectName.trim(),
      description: this.projectDescription.trim(),
      thumbnail: this.thumbnailDataUrl,
      sourceFile: storedSourceFile,
      sourceFileName: file.name,
      sourceType: 'glb-scene',
      importMetadata: {
        sourceFile: file.name,
        partCount: orderedParts.length,
        hierarchy,
        generatedAt: new Date().toISOString(),
        explodeDistance
      },
      models: orderedParts.map(part => ({
        ...part,
        file: storedSourceFile,
        sourceFile: storedSourceFile
      }))
    };

    await this.advanceImportStage(8);
    await this.advanceImportStage(9);
    this.importPreview = {
      project,
      hierarchy: project.importMetadata?.hierarchy || [],
      parts: project.models
    };
    this.showImportPreview = true;
  }

  private advanceImportStage(index: number): Promise<void> {
    const stage = this.importStages[index];

    if (this.currentImportStage && !this.completedStages.includes(this.currentImportStage)) {
      this.completedStages.push(this.currentImportStage);
    }

    this.currentImportStage = stage.message;

    return new Promise(resolve => setTimeout(resolve, 180));
  }

  private loadGlbFromFile(file: File): Promise<THREE.Group> {
    const objectUrl = URL.createObjectURL(file);

    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('GLB parsing timed out. Try a smaller/optimized GLB or check that the file is valid.'));
      }, this.IMPORT_TIMEOUT_MS);

      this.gltfLoader.load(
        objectUrl,
        gltf => {
          window.clearTimeout(timeoutId);
          URL.revokeObjectURL(objectUrl);
          resolve(gltf.scene);
        },
        undefined,
        error => {
          window.clearTimeout(timeoutId);
          URL.revokeObjectURL(objectUrl);
          reject(error instanceof Error ? error : new Error('Unable to parse GLB.'));
        }
      );
    });
  }

  private detectSceneMeshes(scene: THREE.Object3D): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];

    scene.traverse(child => {
      if ((child as THREE.Mesh).isMesh) {
        meshes.push(child as THREE.Mesh);
      }
    });

    return meshes;
  }

  private createPartMetadata(
    mesh: THREE.Mesh,
    index: number,
    modelCenter: THREE.Vector3,
    explodeDistance: number,
    sourceFileName: string,
    sourceFile: string
  ): ProjectFileModel {
    mesh.updateWorldMatrix(true, false);

    const worldPosition = new THREE.Vector3();
    const worldQuaternion = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();

    mesh.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale);

    const worldRotation = new THREE.Euler().setFromQuaternion(worldQuaternion);
    const meshBox = new THREE.Box3().setFromObject(mesh);
    const meshCenter = meshBox.getCenter(new THREE.Vector3());
    const distanceFromCenter = meshCenter.distanceTo(modelCenter);
    const fallbackAngle = (index / Math.max(1, this.detectSceneMeshes(mesh.parent || mesh).length)) * Math.PI * 2;
    const fallbackDirection = new THREE.Vector3(Math.cos(fallbackAngle), Math.sin(fallbackAngle), 0);
    const direction = meshCenter.clone().sub(modelCenter);

    if (direction.length() < 0.0001) {
      direction.copy(fallbackDirection);
    }

    direction.normalize();

    return {
      id: `part-${index + 1}`,
      name: mesh.name || `Part ${index + 1}`,
      file: sourceFile,
      fileName: sourceFileName,
      fileType: 'glb',
      sourceFile,
      meshName: mesh.name || `Mesh ${index + 1}`,
      hierarchyPath: this.getHierarchyPath(mesh),
      parent: mesh.parent?.name || '',
      initialPosition: this.vectorToArray(worldPosition.clone().add(direction.clone().multiplyScalar(explodeDistance))),
      targetPosition: this.vectorToArray(worldPosition),
      originalPosition: this.vectorToArray(worldPosition),
      explodedPosition: this.vectorToArray(worldPosition.clone().add(direction.clone().multiplyScalar(explodeDistance))),
      rotation: this.eulerToArray(worldRotation),
      originalRotation: this.eulerToArray(worldRotation),
      originalScale: this.vectorToArray(worldScale),
      scale: this.roundNumber(worldScale.x || 1),
      assembled: false,
      order: index,
      assemblyStep: index + 1,
      distanceFromCenter: this.roundNumber(distanceFromCenter),
      boundingBox: {
        min: this.vectorToArray(meshBox.min),
        max: this.vectorToArray(meshBox.max)
      },
      centerPoint: this.vectorToArray(meshCenter),
      materialInfo: this.getMaterialInfo(mesh)
    };
  }

  private getMaterialInfo(mesh: THREE.Mesh): { name: string; type: string; color?: string } {
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const color = (material as THREE.MeshStandardMaterial | undefined)?.color;

    return {
      name: material?.name || '',
      type: material?.type || 'Material',
      color: color ? `#${color.getHexString()}` : undefined
    };
  }

  private generateExplodedPositions(
    parts: ProjectFileModel[],
    modelCenter: THREE.Vector3,
    explodeDistance: number
  ): ProjectFileModel[] {
    return parts.map((part, index) => {
      const original = this.arrayToVector(part.originalPosition || part.targetPosition || [0, 0, 0]);
      const centerPoint = this.arrayToVector(part.centerPoint || part.originalPosition || part.targetPosition || [0, 0, 0]);
      let direction = centerPoint.clone().sub(modelCenter);

      if (direction.length() < 0.0001) {
        const angle = (index / Math.max(1, parts.length)) * Math.PI * 2;
        direction = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
      }

      direction.normalize();

      const explodedPosition = original.clone().add(direction.multiplyScalar(explodeDistance));

      return {
        ...part,
        initialPosition: this.vectorToArray(explodedPosition),
        explodedPosition: this.vectorToArray(explodedPosition)
      };
    });
  }

  private generateAssemblySequence(parts: ProjectFileModel[]): ProjectFileModel[] {
    return [...parts]
      .sort((a, b) => (a.distanceFromCenter || 0) - (b.distanceFromCenter || 0))
      .map((part, index) => ({
        ...part,
        id: `part-${index + 1}`,
        order: index,
        assemblyStep: index + 1
      }));
  }

  private buildHierarchyTree(root: THREE.Object3D): ProjectHierarchyNode[] {
    return root.children.map(child => this.toHierarchyNode(child));
  }

  private toHierarchyNode(object: THREE.Object3D): ProjectHierarchyNode {
    return {
      name: object.name || object.type,
      type: (object as THREE.Mesh).isMesh ? 'Mesh' : object.type,
      path: this.getHierarchyPath(object),
      children: object.children.map(child => this.toHierarchyNode(child))
    };
  }

  private getHierarchyPath(object: THREE.Object3D): string {
    const segments: string[] = [];
    let current: THREE.Object3D | null = object;

    while (current) {
      const siblingIndex = current.parent?.children.indexOf(current) ?? 0;
      segments.unshift(`${current.name || current.type || 'Object'}[${siblingIndex}]`);
      current = current.parent;
    }

    return segments.join('/');
  }

  private vectorToArray(vector: THREE.Vector3): number[] {
    return [
      this.roundNumber(vector.x),
      this.roundNumber(vector.y),
      this.roundNumber(vector.z)
    ];
  }

  private eulerToArray(euler: THREE.Euler): number[] {
    return [
      this.roundNumber(euler.x),
      this.roundNumber(euler.y),
      this.roundNumber(euler.z)
    ];
  }

  private arrayToVector(value: number[]): THREE.Vector3 {
    return new THREE.Vector3(value[0] || 0, value[1] || 0, value[2] || 0);
  }

  private roundNumber(value: number): number {
    return Number(value.toFixed(5));
  }

  private async buildProjectModels(): Promise<ProjectFileModel[]> {
    if (this.selectedModelFiles.length) {
      const files = [...this.selectedModelFiles].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true })
      );
      const spacing = 2.2;
      const startX = -((files.length - 1) * spacing) / 2;

      return Promise.all(
        files.map(async (file, index) => {
          const fileType = this.getModelFileType(file.name);

          if (!fileType) {
            throw new Error('Only STL and GLB files are supported in Phase 2.');
          }

          return {
            id: `part-${index + 1}`,
            name: this.getPartName(file.name),
            file: await this.readFileAsDataUrl(file),
            fileName: file.name,
            fileType,
            initialPosition: [startX + index * spacing, 2, 0],
            targetPosition: [0, -2 + index * 0.7, 0],
            rotation: fileType === 'stl' ? [-Math.PI / 2, 0, 0] : [0, 0, 0],
            scale: fileType === 'glb' ? 1 : 0.006,
            assembled: false,
            order: index
          };
        })
      );
    }

    if (this.editingProject && !this.configText.trim()) {
      return this.editingProject.models;
    }

    if (this.configText.trim()) {
      const parsed = JSON.parse(this.configText);
      const models = parsed.models;

      if (!Array.isArray(models)) {
        throw new Error('Config JSON must include a models array.');
      }

      return models.map((model: ProjectFileModel, index: number) => ({
        ...model,
        id: model.id || `part-${index + 1}`,
        name: model.name || model.id || `Part ${index + 1}`,
        fileType: model.fileType || this.getModelFileType(model.file) || 'stl',
        assembled: false,
        order: model.order ?? index
      }));
    }

    return [];
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
      reader.readAsDataURL(file);
    });
  }

  private isSupportedModelFile(file: File): boolean {
    return !!this.getModelFileType(file.name);
  }

  private getModelFileType(fileName: string): 'stl' | 'glb' | null {
    const lowerName = fileName.toLowerCase();

    if (lowerName.endsWith('.stl')) return 'stl';
    if (lowerName.endsWith('.glb')) return 'glb';

    return null;
  }

  private getPartName(fileName: string): string {
    return fileName
      .replace(/\.[^/.]+$/, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, char => char.toUpperCase());
  }
}
