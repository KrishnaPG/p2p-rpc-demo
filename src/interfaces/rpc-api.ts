import { addRoute, z } from "@agree-able/contract";

// Define your functions with Zod
export const AddTwo = z
	.function()
	.args(
		z.object({
			a: z.number(),
			b: z.number(),
		}),
	)
	.returns(z.promise(z.number()));

// Create the API contract
export default {
	role: "calculator",
	version: "1.0.0",
	routes: {
		addTwo: addRoute(AddTwo),
	},
};
