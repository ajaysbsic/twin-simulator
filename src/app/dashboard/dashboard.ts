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
    this.dialogError = '';
    this.showProjectDialog = true;
  }

  openEditDialog(project: ProjectModel) {
    this.editingProject = project;
    this.projectName = project.name;
    this.projectDescription = project.description || '';
    this.configText = JSON.stringify({ models: project.models }, null, 2);
    this.configFileName = 'Current project config';
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

  saveProjectFromDialog() {
    if (!this.projectName.trim()) {
      this.dialogError = 'Project name is required.';
      return;
    }

    try {
      const parsed = JSON.parse(this.configText || '{}');
      const models = parsed.models;

      if (!Array.isArray(models) || models.length === 0) {
        this.dialogError = 'Config JSON must include a non-empty models array.';
        return;
      }

      const project: ProjectModel = {
        id: this.editingProject?.id || Date.now().toString(),
        name: this.projectName.trim(),
        description: this.projectDescription.trim(),
        models
      };

      if (this.editingProject) {
        this.projectService.updateProject(project);
      } else {
        this.projectService.addProject(project);
      }

      this.closeProjectDialog();
      this.loadProjects();
    } catch {
      this.dialogError = 'Config JSON is not valid.';
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
}
