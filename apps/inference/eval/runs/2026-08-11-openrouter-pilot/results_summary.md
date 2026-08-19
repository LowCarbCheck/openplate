# Plate identification bench -- food lists by approach

## 01

| approach | foods |
|---|---|
| baseline | scrambled eggs, baked beans in tomato sauce, back bacon, mini sausages, rye bread, sliced cucumber |
| single_qwen8b | whole wheat bread, bacon, sausage, baked beans, scrambled eggs, cucumber slices |
| ensemble_judge (final) | whole grain toast, bacon, sausages, scrambled eggs, baked beans, cucumber slices |
| ensemble candidate: a_production | whole grain toast, bacon slices, sausages, scrambled eggs, baked beans, cucumber slices |
| ensemble candidate: b_production_hot | whole grain bread, bacon, sausages, scrambled eggs, baked beans, cucumber slices |
| ensemble candidate: c_detection | dark rye bread, baked beans in tomato sauce, scrambled eggs, bacon, small sausages, cucumber slices |
| ensemble candidate: d_taxonomy_first | whole grain bread, baked beans in tomato sauce, scrambled eggs, bacon slices, sausages, cucumber slices |
| ensemble candidate: e_skeptic | whole grain bread, baked beans in tomato sauce, scrambled eggs, bacon, sausages, cucumber slices, butter pat |

## 02

| approach | foods |
|---|---|
| baseline | roast beef with gravy, roast potatoes, yorkshire pudding, steamed broccoli and cabbage |
| single_qwen8b | roast beef with Yorkshire pudding, side salad with broccoli and cabbage, roasted potatoes |
| ensemble_judge (final) | pot roast with gravy, roasted potatoes, mixed vegetables |
| ensemble candidate: a_production | pot roast with gravy, roasted potatoes, mixed vegetables |
| ensemble candidate: b_production_hot | pot roast with gravy, roasted potatoes, mixed vegetables |
| ensemble candidate: c_detection | Roast meat (likely pork or beef) with gravy, Roasted potatoes, Sautéed cabbage and broccoli |
| ensemble candidate: d_taxonomy_first | Roast meat (likely beef or pork) with gravy, Roasted potatoes, Mixed vegetables (broccoli and cabbage), Gravy |
| ensemble candidate: e_skeptic | Roast meat (likely pork or beef with gravy), Roasted potatoes, Mixed vegetables (broccoli, cabbage/savoy), Gravy |

## 03

| approach | foods |
|---|---|
| baseline | pan-seared salmon, mediterranean salad |
| single_qwen8b | grilled salmon, side salad with avocado, cucumber, tomato, red onion, feta cheese, and olives |
| ensemble_judge (final) | grilled salmon, greek salad, feta cheese, avocado, kalamata olives, cherry tomatoes |
| ensemble candidate: a_production | grilled salmon, greek salad with avocado, feta cheese |
| ensemble candidate: b_production_hot | grilled salmon fillets, greek salad with feta and avocado |
| ensemble candidate: c_detection | Grilled Salmon, Feta Cheese, Mixed Salad Greens (Lettuce, Cucumber, Avocado), Cherry Tomatoes, Kalamata Olives, Red Onion |
| ensemble candidate: d_taxonomy_first | grilled salmon, feta cheese, avocado, kalamata olives, cherry tomatoes, cucumber, mixed salad greens, red onion |
| ensemble candidate: e_skeptic | grilled salmon, feta cheese, kalamata olives, avocado, mixed salad vegetables (cucumber, tomato, onion, lettuce) |

## 04

| approach | foods |
|---|---|
| baseline | cheeseburger, french fries, ketchup, pickles |
| single_qwen8b | burger with cheese, tomato, onion, and sauce, french fries, pickles |
| ensemble_judge (final) | cheeseburger, french fries, ketchup, pickles |
| ensemble candidate: a_production | cheeseburger, french fries, ketchup, pickles |
| ensemble candidate: b_production_hot | cheeseburger, potato wedges, ketchup, pickles |
| ensemble candidate: c_detection | Cheeseburger, French Fries, Ketchup, Pickles |
| ensemble candidate: d_taxonomy_first | Cheeseburger, French Fries (Potato Wedges), Ketchup, Pickle |
| ensemble candidate: e_skeptic | cheeseburger, potato wedges, ketchup, pickles |

## 05

| approach | foods |
|---|---|
| baseline | chicken and spinach stew, steamed white rice |
| single_qwen8b | white rice, chicken in curry sauce |
| ensemble_judge (final) | white rice, chicken and spinach stew |
| ensemble candidate: a_production | white rice, chicken and spinach stew |
| ensemble candidate: b_production_hot | white rice, chicken and spinach stew |
| ensemble candidate: c_detection | white rice, chicken stew with greens |
| ensemble candidate: d_taxonomy_first | white rice, chicken and greens stew |
| ensemble candidate: e_skeptic | white rice, chicken stew with greens |

## 06

| approach | foods |
|---|---|
| baseline | salmon and avocado sushi rolls, assorted nigiri sushi, soy sauce |
| single_qwen8b | sushi rolls, sashimi, wasabi, pickled ginger, soy sauce |
| ensemble_judge (final) | sushi rolls, nigiri sushi, soy sauce, pickled ginger, wasabi |
| ensemble candidate: a_production | sushi rolls (maki), nigiri sushi, soy sauce |
| ensemble candidate: b_production_hot | sushi rolls with avocado and fish, nigiri sushi, soy sauce |
| ensemble candidate: c_detection | Sushi Rolls (Uramaki), Tuna Nigiri/Sashimi, White Fish Nigiri, Soy Sauce, Wasabi, Pickled Ginger (Gari) |
| ensemble candidate: d_taxonomy_first | California Roll / Sushi Roll, Tuna Nigiri, White Fish Nigiri, Soy Sauce, Pickled Ginger, Wasabi |
| ensemble candidate: e_skeptic | California roll (avocado/cucumber/crab), Tuna nigiri, White fish nigiri (likely sea bass or snapper), Pickled ginger, Wasabi, Soy sauce |

## 07

| approach | foods |
|---|---|
| baseline | spaghetti bolognese with mixed vegetables |
| single_qwen8b | spaghetti, meat sauce, green beans, corn kernels |
| ensemble_judge (final) | spaghetti bolognese with mixed vegetables |
| ensemble candidate: a_production | spaghetti bolognese with vegetables |
| ensemble candidate: b_production_hot | spaghetti bolognese with vegetables |
| ensemble candidate: c_detection | Spaghetti Bolognese with mixed vegetables, Mixed vegetables (corn, green beans, carrots) |
| ensemble candidate: d_taxonomy_first | spaghetti with meat sauce and mixed vegetables, ground beef in sauce, mixed vegetables (corn, green beans, carrots) |
| ensemble candidate: e_skeptic | spaghetti with meat sauce and vegetables, ground beef, mixed vegetables (corn, green beans, carrots) |

## 08

| approach | foods |
|---|---|
| baseline | yogurt, granola, apple slices |
| single_qwen8b | yogurt with granola and apple slices |
| ensemble_judge (final) | yogurt, granola, apple slices |
| ensemble candidate: a_production | yogurt with granola and apple slices |
| ensemble candidate: b_production_hot | yogurt with granola and apple slices |
| ensemble candidate: c_detection | yogurt, granola, apple slices |
| ensemble candidate: d_taxonomy_first | yogurt, granola, apple slices |
| ensemble candidate: e_skeptic | yogurt, granola, apple slices |

## 09

| approach | foods |
|---|---|
| baseline | chicken pizza |
| single_qwen8b | pizza |
| ensemble_judge (final) | chicken pizza, cola |
| ensemble candidate: a_production | chicken pizza |
| ensemble candidate: b_production_hot | chicken pizza |
| ensemble candidate: c_detection | Cheese Pizza, Cola |
| ensemble candidate: d_taxonomy_first | chicken and cheese pizza |
| ensemble candidate: e_skeptic | chicken pizza |

## 10

| approach | foods |
|---|---|
| baseline | chicken sandwich, side salad, Pepsi Max |
| single_qwen8b | sandwich, side salad, pepsi max |
| ensemble_judge (final) | chicken sandwich, side salad, cola, coffee |
| ensemble candidate: a_production | chicken sandwich, side salad, cola |
| ensemble candidate: b_production_hot | chicken sandwich, side salad, cola |
| ensemble candidate: c_detection | Chicken Sandwich, Mixed Salad Greens, Pepsi, Coffee with milk |
| ensemble candidate: d_taxonomy_first | Chicken sandwich, Mixed green salad, Pepsi Cola, Black coffee |
| ensemble candidate: e_skeptic | Chicken Sandwich, Mixed Green Salad, Pepsi, Coffee |
