import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ProjectService } from '../services/project.service';
import { ProjectModel, ProjectFileModel } from '../models/project.model';

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
  thumbnailDataUrl = '';
  thumbnailFileName = '';
  editingProject: ProjectModel | null = null;
  showProjectDialog = false;
  dialogError = '';

  constructor(
    private projectService: ProjectService,
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
    this.thumbnailDataUrl = '';
    this.thumbnailFileName = '';
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
    this.thumbnailDataUrl = project.thumbnail || '';
    this.thumbnailFileName = project.thumbnail ? 'Current thumbnail' : '';
    this.dialogError = '';
    this.showProjectDialog = true;
  }

  closeProjectDialog() {
    this.showProjectDialog = false;
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
    const files = Array.from(input.files || []);

    this.selectedModelFiles = files.filter(file => this.isSupportedModelFile(file));
    this.dialogError = '';

    if (files.length && this.selectedModelFiles.length !== files.length) {
      this.dialogError = 'Only STL and GLB files are supported in Phase 2.';
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
      const models = await this.buildProjectModels();

      if (!Array.isArray(models) || models.length === 0) {
        this.dialogError = 'Upload at least one STL or GLB file.';
        return;
      }

      const project: ProjectModel = {
        id: this.editingProject?.id || Date.now().toString(),
        name: this.projectName.trim(),
        description: this.projectDescription.trim(),
        thumbnail: this.thumbnailDataUrl,
        models
      };

      if (this.editingProject) {
        this.projectService.updateProject(project);
      } else {
        this.projectService.addProject(project);
      }

      this.closeProjectDialog();
      this.loadProjects();
    } catch (error) {
      this.dialogError =
        error instanceof Error ? error.message : 'Unable to save uploaded model files.';
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
