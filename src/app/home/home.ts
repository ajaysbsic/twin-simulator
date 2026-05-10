import { Component, Output, EventEmitter, ViewChild, Input} from '@angular/core';
import { CommonModule } from '@angular/common';
import { SimulationEngine } from '../engine/simulation.engine';
import { ProjectModel, ProjectFileModel } from '../models/project.model';
import { StepModel } from '../models/assembly.model';
// import assemblyData from '../../assets/data/assembly.json';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class HomeComponent {
  @Input() project!: ProjectModel;
  @Output() stepExecuted = new EventEmitter<{
    success: boolean;
    componentId: string;
  }>();

  // engine = new SimulationEngine(assemblyData as any);
  engine!: SimulationEngine;
  
  // steps = assemblyData.steps;
  steps: StepModel[] = [];

  lastResult: 'success' | 'error' | null = null;

  ngOnInit() {

  // -----------------------------
  // STL PROJECT MODE
  // -----------------------------

  if (this.project?.models?.length) {

    this.steps =
      this.project.models.map(
        (model, index) => ({
          step: index + 1,
          componentId: model.id,
          action: 'attach'
        })
      );

    // Generate engine config dynamically
    const dynamicAssembly = {

      id: this.project.id,

      name: this.project.name,

      components:
        this.project.models.map(
          (model, index) => ({
            id: model.id,

            name: model.id,

            dependencies:
              index === 0
                ? []
                : [this.project.models[index - 1].id]
          })
        ),

      steps: this.steps
    };

    this.engine =
      new SimulationEngine(dynamicAssembly as any);

  }

  // -----------------------------
  // OLD CUBE MODE
  // -----------------------------
  else {

    this.steps = [

      {
        step: 1,
        componentId: 'base',
        action: 'attach'
      },

      {
        step: 2,
        componentId: 'motor',
        action: 'attach'
      },

      {
        step: 3,
        componentId: 'cover',
        action: 'attach'
      }
    ];

    const cubeAssembly = {

      id: 'simple_device',

      name: 'Simple Device',

      components: [

        {
          id: 'base',
          name: 'Base'
        },

        {
          id: 'motor',
          name: 'Motor',
          dependencies: ['base']
        },

        {
          id: 'cover',
          name: 'Cover',
          dependencies: ['motor']
        }
      ],

      steps: this.steps
    };

    this.engine =
      new SimulationEngine(cubeAssembly as any);
  }
}

  executeStep(i: number) {
    const step = this.steps[i];

    const success = this.engine.canExecute(i);

    this.stepExecuted.emit({
      success,
      componentId: step.componentId,
    });
  }

  completeStep(componentId: string) {
    const stepIndex = this.engine.getCurrentStep();
    const step = this.steps[stepIndex];

    if (step?.componentId === componentId) {
      this.engine.complete(stepIndex);
    }
  }

  isStepCompleted(i: number): boolean {
    return i < this.engine.getCurrentStep();
  }

  isCurrentStep(i: number): boolean {
    return i === this.engine.getCurrentStep();
  }
}
