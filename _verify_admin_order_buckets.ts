/** @format */
import mongoose from "mongoose";
import { Db } from "./src/config/db.config.js";
import { OrderService } from "./src/services/order.service.js";

async function main() {
  const db = new Db();
  await db.connect();

  const orderService = new OrderService();

  const counts = await orderService.getAdminOrderStatusCounts();
  console.log("Bucket counts:", counts);

  const metrics = await orderService.getPlatformPerformanceMetrics();
  console.log("performance-metrics delays:", metrics.delays);
  console.log(
    "delayed bucket matches performance-metrics delays:",
    counts.delayed === metrics.delays,
  );

  const totalViaBuckets =
    counts.in_progress + counts.delayed + counts.completed + counts.cancelled;
  console.log("Sum of buckets:", totalViaBuckets, "vs totalOrders:", metrics.totalOrders);
  console.log("Buckets partition all orders:", totalViaBuckets === metrics.totalOrders);

  const page1 = await orderService.getAllOrdersForAdmin({ bucket: "in_progress", page: 1, limit: 5 });
  console.log("in_progress page1 pagination:", page1.pagination);
  console.log("in_progress page1 sample statuses:", page1.orders.map((o: any) => o.status));

  const page1completed = await orderService.getAllOrdersForAdmin({ bucket: "completed", page: 1, limit: 5 });
  console.log("completed page1 pagination:", page1completed.pagination);
  console.log("completed page1 sample statuses:", page1completed.orders.map((o: any) => o.status));
  console.log("completed page1 sample items:", page1completed.orders.map((o: any) => o.items));
}

main()
  .then(() => console.log("\nVerification complete."))
  .catch((err) => {
    console.error("Verification failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
