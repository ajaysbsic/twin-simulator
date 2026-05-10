import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ViewerPage } from './viewer-page';

describe('ViewerPage', () => {
  let component: ViewerPage;
  let fixture: ComponentFixture<ViewerPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ViewerPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ViewerPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
