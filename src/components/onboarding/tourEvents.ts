// Lets any screen (the header help button, a menu item) ask the tour to start without importing the tour itself.
export const START_TOUR_EVENT = "apas:start-tour";

export function startProductTour() {
  window.dispatchEvent(new CustomEvent(START_TOUR_EVENT));
}
