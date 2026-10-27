export interface ScoreInput {
  ctr: number;
  conversionRate: number;
  profitScore: number;
  relevanceScore: number;
  inventoryScore: number;
}
export class ProductScorer {
  calculate(x: ScoreInput) {
    return (
      x.ctr * 0.2 +
      x.conversionRate * 0.3 +
      x.profitScore * 0.2 +
      x.relevanceScore * 0.2 +
      x.inventoryScore * 0.1
    );
  }
}
